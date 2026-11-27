import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createWriteStream} from 'node:fs';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {BlockList, Server as NetServer} from 'node:net';
import {networkInterfaces, tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {FPS, validateProject} from './project.mjs';

const host = '127.0.0.1';
const serverFile = fileURLToPath(import.meta.url);
const renderEntry = fileURLToPath(new URL('./render-entry.tsx', import.meta.url));
const studioRoot = dirname(serverFile);
const dist = join(studioRoot, 'dist');
const hmrPath = '/__studio_hmr';
const maxAudioBytes = 25 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;
const maxBodyBytes = maxAudioBytes + maxVideoBytes + 1024 * 1024;
const parseBody = express.raw({type: () => true, limit: maxBodyBytes, inflate: false});
// The render worker reports progress on its stdout. Remotion logs to stdout
// too, so every progress line carries this marker.
const progressPrefix = '#remain-progress#';
// One bar for the whole job: each stage owns a slice, so the bar never walks
// backwards when a stage restarts its own 0-100 scale.
const phaseFloor = {upload: 0, prepare: 5, bundle: 5, render: 25, encoding: 25, muxing: 25, done: 100};
const phaseSpan = {prepare: 0, bundle: 20, render: 75, encoding: 75, muxing: 75};
// A finished MP4 waits in the job directory until it is downloaded, or this long
// passes. The host keeps /tmp on tmpfs, so an abandoned video must not linger.
const jobOutputTtlMs = 30 * 60_000;
// A finished, failed or cancelled job stays readable for a short while, because
// a client that was reloading needs to learn how its render ended.
const jobRecordGraceMs = 60_000;
// A POST holds the single render slot from the moment it arrives, while it is
// still reading the body. This placeholder is what a second tab sees.
const acceptingUpload = 'accepting-upload';

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function parseUpload(req, res) {
  if (!req.is('multipart/form-data')) {
    throw new RequestError(415, 'Send the project as multipart form data.');
  }
  if (Number(req.headers['content-length']) > maxBodyBytes) {
    throw new RequestError(413, 'Upload is too large.');
  }
  try {
    await new Promise((resolve, reject) => {
      parseBody(req, res, (error) => error ? reject(error) : resolve());
    });
  } catch (error) {
    if (error.status === 413) throw new RequestError(413, 'Upload is too large.');
    throw new RequestError(400, 'Could not read the multipart upload.');
  }
  let form;
  try {
    const request = new Request('http://127.0.0.1/api/render', {
      method: 'POST',
      headers: {'content-type': req.headers['content-type']},
      body: req.body,
    });
    form = await request.formData();
  } catch {
    throw new RequestError(400, 'Malformed multipart upload.');
  } finally {
    req.body = undefined;
  }
  const fields = new Set();
  for (const key of form.keys()) {
    if (fields.has(key) || !['project', 'audio', 'video', 'gpu'].includes(key)) {
      throw new RequestError(400, 'Send one project and at most one audio file and one video file.');
    }
    fields.add(key);
  }
  const rawProject = form.get('project');
  if (typeof rawProject !== 'string') throw new RequestError(400, 'A JSON project is required.');
  let project;
  try {
    project = validateProject(JSON.parse(rawProject));
  } catch {
    throw new RequestError(400, 'The project is invalid.');
  }
  const audio = form.get('audio');
  if (audio !== null && !(audio instanceof File)) {
    throw new RequestError(400, 'Audio must be uploaded as a file.');
  }
  if (audio?.size > maxAudioBytes) throw new RequestError(413, 'Audio is limited to 25 MiB.');
  if (audio?.size === 0) throw new RequestError(422, 'The audio file is empty.');
  const video = form.get('video');
  if (video !== null && !(video instanceof File)) {
    throw new RequestError(400, 'Video must be uploaded as a file.');
  }
  if (video?.size > maxVideoBytes) throw new RequestError(413, 'Video is limited to 100 MiB.');
  if (video?.size === 0) throw new RequestError(422, 'The video file is empty.');
  // Optional: draw the frames with the machine's iGPU. It is a flag, never a path
  // or an executable, so it cannot turn into an argument the server trusts.
  const gpuRaw = form.get('gpu');
  const gpu = gpuRaw === null ? false : ['1', 'true', 'yes'].includes(String(gpuRaw).toLowerCase());
  return {project, audio, video, gpu};
}

function sendFile(res, filename) {
  return new Promise((resolve, reject) => {
    const onClose = () => resolve();
    res.once('close', onClose);
    res.sendFile(basename(filename), {root: dirname(filename), cacheControl: false}, (error) => {
      res.off('close', onClose);
      if (error && !res.destroyed) reject(error);
      else resolve();
    });
  });
}

async function normalizeAudio(audio, project, workspace, signal) {
  if (audio.size === 0) throw new RequestError(422, 'The audio file is empty.');
  const source = join(workspace, 'audio-upload');
  const target = join(workspace, 'audio.wav');
  const seconds = mediaEndSeconds(project);
  await pipeline(audio.stream(), createWriteStream(source), {signal});
  try {
    // Ignore uploaded filenames and MIME types. Only decode local media formats,
    // then serve a known WAV instead of giving Chromium the uploaded bytes.
    await runProcess('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror',
      '-abort_on', 'empty_output', '-protocol_whitelist', 'file',
      '-format_whitelist', 'wav,mp3,mov,ogg,flac,aac,matroska,aiff',
      '-threads', '1', '-i', source, '-map', '0:a:0', '-map_metadata', '-1',
      '-t', String(seconds), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', target,
    ], {workspace, signal, timeoutMs: Math.min(30 * 60_000, 30_000 + 250 * seconds)});
  } catch (error) {
    if (signal.aborted || error.code === 'ENOENT') throw error;
    if (error.code === 'JOB_TIMEOUT') throw new RequestError(504, 'Audio preparation timed out.');
    throw new RequestError(422, 'The audio file could not be decoded. Try WAV, MP3, M4A, Ogg, FLAC, AAC or WebM.');
  } finally {
    await rm(source, {force: true});
  }
  return target;
}

function mediaEndSeconds(project) {
  // Keep the source start at zero; Remotion renders against the original timeline.
  return (project.renderRange?.endFrame ?? project.durationInFrames) / FPS;
}

async function normalizeVideo(video, project, workspace, signal) {
  if (video.size === 0) throw new RequestError(422, 'The video file is empty.');
  const source = join(workspace, 'video-upload');
  const target = join(workspace, 'video.mp4');
  const seconds = mediaEndSeconds(project);
  await pipeline(video.stream(), createWriteStream(source), {signal});
  try {
    await runProcess('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-abort_on', 'empty_output',
      '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska',
      '-threads', '2', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
      '-map_metadata', '-1', '-map_chapters', '-1', '-t', String(seconds),
      '-filter_threads', '2', '-vf',
      "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1",
      '-fpsmax', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-threads:v', '2',
      '-maxrate', '4M', '-bufsize', '8M', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart', target,
    ], {workspace, signal, timeoutMs: Math.min(2 * 60 * 60_000, 120_000 + 4000 * seconds)});
  } catch (error) {
    if (signal.aborted || error.code === 'ENOENT') throw error;
    if (error.code === 'JOB_TIMEOUT') throw new RequestError(504, 'Video preparation timed out.');
    throw new RequestError(422, 'The video file could not be decoded. Try MP4, MOV, WebM or MKV.');
  } finally {
    await rm(source, {force: true});
  }
  return target;
}

export async function startStudioServer({port = process.env.PORT ?? 4317,
  bindHost = process.env.STUDIO_BIND ?? host, lanHost = process.env.STUDIO_LAN_HOST, render = runRenderer,
  staticRoot = dist, dev = false, outputTtlMs = Number(process.env.STUDIO_RENDER_TTL_MS ?? jobOutputTtlMs)} = {}) {
  if (!Number.isFinite(outputTtlMs) || outputTtlMs < 0) throw Error('outputTtlMs must be a non-negative number.');
  if (bindHost !== host && bindHost !== '0.0.0.0') throw Error('STUDIO_BIND must be 127.0.0.1 or 0.0.0.0.');
  let lanPeers;
  if (bindHost === '0.0.0.0') {
    const iface = Object.values(networkInterfaces()).flat().find(n =>
      n.family === 'IPv4' && n.address === lanHost && !n.internal && n.cidr);
    if (!iface || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(lanHost)) {
      throw Error('Set STUDIO_LAN_HOST to a private IPv4 address assigned to this machine.');
    }
    lanPeers = new BlockList();
    lanPeers.addSubnet(lanHost, Number(iface.cidr.split('/')[1]), 'ipv4');
  }
  if (!/^\d+$/.test(String(port)) || Number(port) > 65535) {
    throw new Error('PORT must be an integer from 0 to 65535.');
  }
  const app = express();
  app.disable('x-powered-by');
  const allowedLocalRequest = req => {
    const authority = req.headers.host;
    const boundPort = req.socket.localPort;
    const permits = address => authority === `${address}:${boundPort}` || (boundPort === 80 && authority === address);
    const loopback = req.socket.remoteAddress === host && req.socket.localAddress === host && (permits(host) || permits('localhost'));
    const lan = lanPeers && req.socket.localAddress === lanHost && permits(lanHost) && lanPeers.check(req.socket.remoteAddress, 'ipv4');
    return Boolean(loopback || lan);
  };
  app.use((req, res, next) => {
    if (!allowedLocalRequest(req)) return res.status(403).json({error: 'Studio only accepts requests from its configured local network.'});
    next();
  });

  // A render is a job, not a request. Closing the tab must not kill it, and the
  // finished MP4 waits in the job directory until it is downloaded or expires.
  // Job ids are random UUIDs and are the only handle to a job; nothing a client
  // sends is ever used as a path.
  const jobs = new Map();
  let running = null;
  let media;

  const jobView = (job) => ({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    renderedFrames: job.renderedFrames,
    totalFrames: job.totalFrames,
    etaMs: job.etaMs,
    elapsedMs: (job.finishedAtMs ?? Date.now()) - job.createdAtMs,
    ...(job.error ? {error: job.error} : {}),
  });
  const sameOriginRequest = (req) => {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    return !((origin !== undefined && origin !== `http://${req.headers.host}`)
      || (site !== undefined && site !== 'same-origin' && site !== 'none'));
  };
  const removeJobFiles = async (job) => {
    try {
      await rm(job.dir, {recursive: true, force: true});
    } catch (error) {
      console.error('Studio render cleanup failed:', error);
    }
  };
  const disposeJob = async (job) => {
    jobs.delete(job.id);
    if (job.timer) clearTimeout(job.timer);
    await removeJobFiles(job);
  };
  // The workspace is gone but the outcome stays readable, so a client that was
  // mid-reload can still report 'Đã huỷ' instead of losing the job entirely.
  const retireJob = (job) => {
    if (job.timer) clearTimeout(job.timer);
    job.timer = setTimeout(() => jobs.delete(job.id), jobRecordGraceMs);
    job.timer.unref?.();
  };

  const runJob = async (job, {project, audio, video, gpu, localPort}) => {
    const assets = {};
    media = assets;
    const report = (update) => {
      if (job.status !== 'running') return;
      const ratio = Math.min(1, Math.max(0, update.progress ?? job.progress));
      Object.assign(job, update, {
        progress: ((phaseFloor[update.phase] ?? 0) + (phaseSpan[update.phase] ?? 0) * ratio) / 100,
      });
    };
    try {
      const prepare = async (kind, file, normalize) => {
        if (!file) return null;
        const path = await normalize(file, project, job.dir, job.controller.signal);
        const id = randomUUID();
        assets[kind] = {id, path};
        return `http://${host}:${localPort}/api/internal/${kind}/${id}`;
      };
      if (audio || video) report({phase: 'prepare'});
      const audioSrc = await prepare('audio', audio, normalizeAudio);
      const videoSrc = await prepare('video', video, normalizeVideo);
      const range = project.renderRange;
      await render({inputProps: {project, audioSrc, videoSrc}, gpu,
        ...(range ? {frameRange: [range.startFrame, range.endFrame - 1]} : {}),
        outputLocation: job.outputLocation, workspace: job.dir,
        signal: job.controller.signal, report});
      // Normalized media, the bundle and the worker job file are transient: only
      // the MP4 survives, and only until it is downloaded or the TTL expires.
      for (const entry of await readdir(job.dir)) {
        if (entry !== 'clip.mp4') await rm(join(job.dir, entry), {recursive: true, force: true});
      }
      job.status = 'done';
      job.phase = 'done';
      job.progress = 1;
      job.finishedAtMs = Date.now();
      job.timer = setTimeout(() => void disposeJob(job), outputTtlMs);
      job.timer.unref?.();
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      job.status = cancelled ? 'cancelled' : 'failed';
      job.phase = job.status;
      job.finishedAtMs = Date.now();
      if (!cancelled) {
        job.error = error instanceof RequestError ? error.message
          : 'Could not render the video. Check the Studio server logs.';
        if (!(error instanceof RequestError)) console.error('Studio render failed:', error);
      }
      await removeJobFiles(job);
      retireJob(job);
    } finally {
      media = undefined;
      if (running === job.id) running = null;
    }
  };

  app.get('/api/internal/:kind/:id', async (req, res) => {
    const {kind, id} = req.params;
    if (kind !== 'audio' && kind !== 'video') return res.sendStatus(404);
    if (req.socket.remoteAddress !== host || req.socket.localAddress !== host) return res.sendStatus(403);
    const asset = media?.[kind];
    if (!asset || id !== asset.id) return res.sendStatus(404);
    res.set({'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'});
    try {
      await sendFile(res, asset.path);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else res.sendStatus(error.status === 416 ? 416 : 404);
    }
  });

  app.get('/api/render/jobs/:id', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({error: 'That render job no longer exists.'});
    res.json(jobView(job));
  });

  app.get('/api/render/jobs/:id/file', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({error: 'That render job no longer exists.'});
    if (job.status !== 'done') return res.status(409).json({error: 'That render has no finished video yet.'});
    try {
      res.type('mp4').attachment('remain-studio.mp4');
      await sendFile(res, job.outputLocation);
      await disposeJob(job);
    } catch (error) {
      console.error('Studio video download failed:', error);
      if (res.headersSent) res.destroy();
      else res.sendStatus(404);
    }
  });

  app.post('/api/render/jobs/:id/cancel', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOriginRequest(req)) return res.status(403).json({error: 'Open Studio locally to cancel a render.'});
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({error: 'That render job no longer exists.'});
    if (job.status !== 'running') return res.status(409).json({error: 'That render already finished.'});
    job.controller.abort();
    res.json({id: job.id, status: 'cancelling'});
  });

  app.post('/api/render', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!sameOriginRequest(req)) return res.status(403).json({error: 'Open Studio locally to render a video.'});
    // The slot is claimed synchronously, before the first await. Reading a
    // 100 MiB upload takes time, and two tabs that both passed a later check
    // would render at once and overwrite each other's media on a machine that
    // only has room for one render.
    if (running) return res.status(409).json({error: 'A render is already in progress.'});
    running = acceptingUpload;
    const releaseClaim = () => { if (running === acceptingUpload) running = null; };
    // A client that hangs up mid-upload must not leave the slot held forever.
    req.once('close', () => { if (!req.complete) releaseClaim(); });
    let upload;
    try {
      upload = await parseUpload(req, res);
    } catch (error) {
      releaseClaim();
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      if (error instanceof RequestError) return res.status(error.status).json({error: error.message});
      console.error('Studio upload failed:', error);
      res.status(500).json({error: 'Could not read the upload. Check the Studio server logs.'});
      return;
    }
    let dir;
    try {
      dir = await mkdtemp(join(tmpdir(), 'remain-render-'));
    } catch (error) {
      releaseClaim();
      console.error('Studio render workspace failed:', error);
      return res.status(500).json({error: 'Could not create a render workspace.'});
    }
    const job = {id: randomUUID(), status: 'running', phase: 'upload', progress: 0,
      renderedFrames: 0, totalFrames: null, etaMs: null, createdAtMs: Date.now(),
      finishedAtMs: null, error: null, dir, outputLocation: join(dir, 'clip.mp4'),
      controller: new AbortController(), timer: null};
    jobs.set(job.id, job);
    // The placeholder becomes the real job before any other request can race for it.
    running = job.id;
    res.status(202).json({jobId: job.id});
    // The job outlives this request on purpose: a reload or a closed tab must
    // not abandon a render that is already spending CPU.
    void runJob(job, {...upload, localPort: req.socket.localPort});
  });

  const server = createServer({headersTimeout: 10_000, requestTimeout: 120_000, connectionsCheckingInterval: 1000}, app);
  server.once('close', () => {
    // A Studio that is going down must not leave Chromium or ffmpeg children of a
    // running job behind, because those jobs no longer have anyone to report to.
    for (const job of jobs.values()) {
      job.controller.abort();
      if (job.timer) clearTimeout(job.timer);
      void removeJobFiles(job);
    }
    jobs.clear();
  });
  const vite = dev ? await mountStudioVite(app, server, allowedLocalRequest) : null;
  if (!vite) app.use(express.static(staticRoot));
  try {
    server.listen(Number(port), bindHost);
    await once(server, 'listening');
    return server;
  } catch (error) {
    await vite?.close();
    throw error;
  }
}

async function mountStudioVite(app, server, allowedLocalRequest) {
  const {createServer: createViteServer} = await import('vite');
  // Vite attaches its upgrade handler to this unbound server. Forward only
  // requests that passed Studio's LAN and same-origin checks on the real port.
  const upgrades = createServer();
  const vite = await createViteServer({
    root: studioRoot,
    server: {
      middlewareMode: true,
      cors: false,
      hmr: {server: upgrades, path: hmrPath},
      fs: {
        allow: [studioRoot, join(studioRoot, '../node_modules')],
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/studio/server.mjs', '**/studio/test/**'],
      },
    },
  });
  app.use(vite.middlewares);
  server.on('upgrade', (req, socket, head) => {
    const acceptedProtocol = ['vite-hmr', 'vite-ping'].includes(req.headers['sec-websocket-protocol']);
    if (!allowedLocalRequest(req) || req.headers.origin !== `http://${req.headers.host}` || !acceptedProtocol || req.url?.split('?')[0] !== hmrPath) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    upgrades.emit('upgrade', req, socket, head);
  });
  server.once('close', () => { void vite.close().catch(error => console.error('Studio dev server cleanup failed:', error)); });
  return vite;
}

async function runRenderer({inputProps, frameRange, gpu, outputLocation, workspace, signal, report}) {
  const jobPath = join(workspace, 'render-job.json');
  await writeFile(jobPath, JSON.stringify({inputProps, frameRange, gpu}), {signal});
  const frames = frameRange ? frameRange[1] - frameRange[0] + 1 : inputProps.project.durationInFrames;
  // Chromium and the encoder can be much slower than playback on low-power hosts.
  const timeoutMs = Math.min(12 * 60 * 60_000, 5 * 60_000 + 10_000 * frames / FPS);
  try {
    await runProcess(process.execPath, [serverFile, '--render-worker', workspace, jobPath, outputLocation], {
      workspace, signal, timeoutMs, onProgressLine: report,
    });
  } catch (error) {
    if (error.code === 'JOB_TIMEOUT') throw new RequestError(504, 'Video rendering timed out.');
    throw error;
  }
}

function runProcess(command, args, {workspace, signal, timeoutMs, onProgressLine}) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(command, args, {
      detached,
      env: {...process.env, TMPDIR: workspace, TEMP: workspace, TMP: workspace},
      stdio: ['ignore', onProgressLine ? 'pipe' : 'ignore', 'pipe'],
    });
    let stderr = '';
    let stdoutTail = '';
    let failure;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    if (onProgressLine) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdoutTail = (stdoutTail + chunk).slice(-16_384);
        const lines = stdoutTail.split('\n');
        stdoutTail = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith(progressPrefix)) continue;
          try {
            onProgressLine(JSON.parse(line.slice(progressPrefix.length)));
          } catch {
            // A malformed progress line must not fail an otherwise healthy render.
          }
        }
      });
    }
    const stop = (error) => {
      if (failure) return;
      failure = error;
      try {
        if (child.pid && detached) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch (killError) {
        if (killError.code !== 'ESRCH') console.error('Studio worker termination failed:', killError);
      }
    };
    const abort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(Object.assign(new Error('Studio subprocess timed out'), {code: 'JOB_TIMEOUT'})), timeoutMs);
    signal.addEventListener('abort', abort, {once: true});
    child.once('error', (error) => { failure ??= error; });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`Studio subprocess failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function renderWorker(workspace, jobPath, outputLocation) {
  // This isolated worker also owns Remotion's transient HTTP servers. Remotion
  // 4 otherwise binds them to all interfaces, even when called by a local app.
  const listen = NetServer.prototype.listen;
  NetServer.prototype.listen = function (options, ...args) {
    if (options?.host === '0.0.0.0' || options?.host === '::') options = {...options, host};
    return listen.call(this, options, ...args);
  };
  const [{bundle}, {renderMedia, selectComposition}] = await Promise.all([
    import('@remotion/bundler'), import('@remotion/renderer'),
  ]);
  const {inputProps, frameRange, gpu} = JSON.parse(await readFile(jobPath, 'utf8'));
  // Remotion has no VAAPI encoder, so on an Intel/AMD machine the iGPU can only draw
  // the frames. Measured on the N100: 90 frames 3.84 fps -> 4.59 fps, PSNR 46.8 dB
  // against the CPU render. 'angle-egl' produced a byte-identical file, so it is a no-op here.
  const totalFrames = frameRange ? frameRange[1] - frameRange[0] + 1 : inputProps.project.durationInFrames;
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || undefined;
  const report = (update) => process.stdout.write(`${progressPrefix}${JSON.stringify(update)}\n`);
  // Bundlers and frame renderers report far more often than a UI needs.
  let lastPercent = -1;
  const emit = (update) => {
    const percent = Math.round((update.progress ?? 0) * 100);
    if (percent > lastPercent) { lastPercent = percent; report(update); }
  };
  // bundle() reports a 0-100 percentage, not a 0-1 ratio.
  const serveUrl = await bundle({entryPoint: renderEntry, outDir: join(workspace, 'bundle'),
    onProgress: (percent) => emit({phase: 'bundle', progress: percent / 100})});
  lastPercent = -1;
  const chromiumOptions = gpu ? {gl: 'vulkan'} : undefined;
  const composition = await selectComposition({serveUrl, id: 'StudioClip', inputProps, browserExecutable,
    ...(chromiumOptions ? {chromiumOptions} : {})});
  report({phase: 'render', progress: 0, renderedFrames: 0, totalFrames, etaMs: null});
  await renderMedia({serveUrl, composition, inputProps, outputLocation, codec: 'h264', concurrency: 1, browserExecutable,
    ...(chromiumOptions ? {chromiumOptions} : {}),
    onProgress: ({progress, renderedFrames, renderEstimatedTime, stitchStage}) =>
      emit({phase: stitchStage, progress, renderedFrames, totalFrames, etaMs: renderEstimatedTime}),
    ...(frameRange ? {frameRange} : {})});
}

if (process.argv[1] && resolve(process.argv[1]) === serverFile) {
  if (process.argv[2] === '--render-worker') {
    await renderWorker(...process.argv.slice(3));
  } else {
    const dev = process.argv.includes('--dev');
    // A crash or a restart can leave job directories in the RAM-backed temp dir,
    // and nothing else ever reclaims that memory. Only the real server process
    // sweeps, so test servers running side by side cannot delete each other.
    for (const entry of await readdir(tmpdir()).catch(() => [])) {
      if (entry.startsWith('remain-render-')) await rm(join(tmpdir(), entry), {recursive: true, force: true}).catch(() => {});
    }
    const server = await startStudioServer({dev});
    console.log(`Remain Studio${dev ? ' (dev)' : ''}: http://${host}:${server.address().port}`);
    if (server.address().address === '0.0.0.0') console.log(`Remain Studio LAN: http://${process.env.STUDIO_LAN_HOST}:${server.address().port}`);
    for (const signum of ['SIGINT', 'SIGTERM']) process.once(signum, () => {
      server.close();
      server.closeAllConnections();
    });
  }
}
