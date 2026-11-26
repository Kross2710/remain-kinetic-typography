import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {access, writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {networkInterfaces} from 'node:os';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

const project = {
  width: 720,
  height: 1280,
  durationInFrames: 30,
  cues: [{text: 'Hello', start: 0, words: [{text: 'Hello', start: 0}]}],
};
const mp4 = Buffer.from('fake renderer output');
const render = ({outputLocation}) => writeFile(outputLocation, mp4);
const exec = promisify(execFile);

async function studio(t, options = {}) {
  const {startStudioServer} = await import('../server.mjs');
  const server = await startStudioServer({port: 0, render, ...options});
  t.after(async () => {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
  });
  const {address, port} = server.address();
  assert.equal(address, '127.0.0.1');
  return `http://${address}:${port}`;
}

function form(value = project, audio, video) {
  const data = new FormData();
  data.set('project', JSON.stringify(value));
  if (audio) data.set('audio', audio, 'sample.wav');
  if (video) data.set('video', video, 'sample.mkv');
  return data;
}

function post(base, body = form(), headers) {
  return fetch(`${base}/api/render`, {method: 'POST', body, headers});
}

test('serves Vite source and HMR on the Studio port without bypassing the render API or LAN boundary', async (t) => {
  const base=await studio(t,{dev:true});
  const page=await fetch(`${base}/`);
  assert.equal(page.status,200);
  assert.match(await page.text(), /\/\@vite\/client/);
  const app=await fetch(`${base}/App.tsx`);
  assert.equal(app.status,200);
  assert.match(await app.text(), /react-refresh/);
  const source=await fetch(`${base}/server.mjs`);
  assert.equal(source.status,403);
  await source.arrayBuffer();
  const response=await post(base,form(),{Origin:base});
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),mp4);
  const status=await new Promise((resolve,reject)=>{
    const req=request(`${base}/__studio_hmr`,{headers:{Connection:'Upgrade',Upgrade:'websocket',Origin:'http://example.org','Sec-WebSocket-Protocol':'vite-hmr'}},res=>{
      res.resume();resolve(res.statusCode);
    });
    req.on('upgrade',(_res,socket)=>{socket.destroy();reject(Error('Cross-origin dev WebSocket was accepted'));});
    req.on('error',reject);
    req.end();
  });
  assert.equal(status,403);
});

test('exports MP4 from a validated multipart project with no media', async (t) => {
  let props;
  const base = await studio(t, {render: async (job) => {
    props = job.inputProps;
    assert.equal(Object.hasOwn(job, 'frameRange'), false);
    await render(job);
  }});
  const response = await post(base, form({...project, audioSrc: 'https://example.org/audio', videoSrc: 'https://example.org/video'}), {Origin: base});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^video\/mp4\b/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
  assert.deepEqual(props, {project, audioSrc: null, videoSrc: null});
});

test('rejects cross-origin renders, including opaque browser origins', async (t) => {
  let renders = 0;
  const base = await studio(t, {render: async (job) => { renders++; await render(job); }});
  for (const headers of [
    {Origin: 'https://example.org'},
    {Origin: 'null'},
    {'Sec-Fetch-Site': 'cross-site'},
  ]) {
    const response = await post(base, form(), headers);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(renders, 0);
});

test('rejects a DNS-rebound Host even when the Origin matches it', async (t) => {
  const base = await studio(t);
  const rogue = 'example.org:4317';
  const response = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/render`, {
      method: 'POST', headers: {Host: rogue, Origin: `http://${rogue}`},
    }, resolve);
    req.on('error', reject);
    req.end();
  });
  response.resume();
  assert.equal(response.statusCode, 403);
});

test('LAN opt-in binds all IPv4 interfaces but only trusts the selected local authority', async (t) => {
  const {startStudioServer} = await import('../server.mjs');
  await assert.rejects(startStudioServer({port:0,bindHost:'0.0.0.0'}),/private.*IPv4/i);
  const ip = Object.values(networkInterfaces()).flat().find(n=>n.family==='IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(n.address))?.address;
  if (!ip) return t.skip('No private IPv4 interface to exercise LAN mode');
  const server=await startStudioServer({port:0,bindHost:'0.0.0.0',lanHost:ip,render});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  assert.equal(server.address().address,'0.0.0.0');
  const base=`http://${ip}:${server.address().port}`;
  const ok=await post(base,form(),{Origin:base,'Sec-Fetch-Site':'same-origin'});
  assert.equal(ok.status,200);
  await ok.arrayBuffer();
  const blocked=await post(base,form(),{Origin:'http://example.org','Sec-Fetch-Site':'cross-site'});
  assert.equal(blocked.status,403);
  await blocked.arrayBuffer();
  for (const kind of ['audio', 'video']) {
    const hidden=await fetch(`${base}/api/internal/${kind}/test`);
    assert.equal(hidden.status,403);
    await hidden.arrayBuffer();
  }
});

function wav(seconds = 0.1) {
  const bytes = seconds * 16_000;
  const data = Buffer.alloc(44 + bytes);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24);
  data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(bytes, 40);
  return new Blob([data], {type: 'audio/wav'});
}

test('serves normalized local audio to the renderer with byte ranges, then removes it', async (t) => {
  let source;
  let workspace;
  const base = await studio(t, {render: async (job) => {
    source = job.inputProps.audioSrc;
    workspace = job.workspace;
    assert.equal(new URL(source).origin, base);
    const media = await fetch(source, {headers: {Range: 'bytes=0-11', Origin: 'http://localhost:54321'}});
    assert.equal(media.status, 206);
    assert.match(media.headers.get('content-range'), /^bytes 0-11\//);
    assert.equal(media.headers.get('access-control-allow-origin'), '*');
    assert.equal(Buffer.from(await media.arrayBuffer()).toString('ascii', 8), 'WAVE');
    await render(job);
  }});
  const response = await post(base, form(project, wav()));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const expired = await fetch(source);
  assert.equal(expired.status, 404);
  await expired.arrayBuffer();
  await waitForRemoval(workspace);
});

test('normalizes an uploaded video and serves it alongside an independent audio upload', async (t) => {
  const {stdout} = await exec('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=1440x720:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1',
    '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-f', 'matroska', 'pipe:1',
  ], {encoding: 'buffer'});
  let inputProps, workspace;
  const base = await studio(t, {render: async (job) => {
    ({inputProps, workspace} = job);
    const {audioSrc, videoSrc} = inputProps;
    assert.equal(new URL(videoSrc).origin, base);
    assert.match(new URL(videoSrc).pathname, /^\/api\/internal\/video\/[\da-f-]{36}$/);
    const wrongKind = await fetch(audioSrc.replace('/audio/', '/video/'));
    assert.equal(wrongKind.status, 404);
    await wrongKind.arrayBuffer();
    const response = await fetch(videoSrc, {headers: {Range: 'bytes=0-11', Origin: base}});
    assert.equal(response.status, 206);
    assert.match(response.headers.get('content-type'), /^video\/mp4\b/);
    assert.match(response.headers.get('content-range'), /^bytes 0-11\//);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
    const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_name,width,height,pix_fmt', '-of', 'json', videoSrc]);
    assert.deepEqual(JSON.parse(stdout).streams, [
      {codec_name: 'h264', width: 1280, height: 640, pix_fmt: 'yuv420p'}, {codec_name: 'aac'},
    ]);
    const audioResponse = await fetch(audioSrc);
    assert.equal(Buffer.from(await audioResponse.arrayBuffer()).toString('ascii', 8, 12), 'WAVE');
    await render(job);
  }});
  const response = await post(base, form(project, wav(), new Blob([stdout])));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const expired = await fetch(inputProps.videoSrc);
  assert.equal(expired.status, 404);
  await expired.arrayBuffer();
  await waitForRemoval(workspace);
});

test('accepts silent MP4, MOV and WebM uploads as video-only projects', async (t) => {
  for (const container of ['mp4', 'mov', 'webm']) {
    await t.test(container, async (t) => {
      const codec = container === 'webm' ? ['-c:v', 'libvpx'] : ['-c:v', 'mpeg4', '-movflags', '+frag_keyframe+empty_moov'];
      const {stdout} = await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
        'color=blue:size=64x96:rate=4', '-t', '1', ...codec, '-f', container, 'pipe:1'], {encoding: 'buffer'});
      const base = await studio(t, {render: async (job) => {
        assert.equal(job.inputProps.audioSrc, null);
        const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name',
          '-of', 'csv=p=0', job.inputProps.videoSrc]);
        assert.equal(stdout.trim(), 'h264');
        await render(job);
      }});
      const response = await post(base, form({...project, cues: []}, undefined, new Blob([stdout])));
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    });
  }
});

test('passes an inclusive Remotion range without shifting the media or shortening the project', async (t) => {
  const rangeProject = {...project, cues: [], durationInFrames: 5400,
    renderRange: {startFrame: 959, endFrame: 960}};
  const base = await studio(t, {render: async (job) => {
    assert.deepEqual(job.inputProps.project, rangeProject);
    assert.deepEqual(job.frameRange, [959, 959]);
    const {stdout} = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', job.inputProps.audioSrc]);
    assert.equal(Number(stdout), 32);
    await render(job);
  }});
  const response = await post(base, form(rangeProject, wav(45)));
  assert.equal(response.status, 200);
  await response.arrayBuffer();
});

test('reports render progress while a render is running', async (t) => {
  const entered = Promise.withResolvers();
  const midRender = Promise.withResolvers();
  const base = await studio(t, {render: async (job) => {
    entered.resolve(job);
    await midRender.promise;
    await render(job);
  }});
  const first = post(base);
  const job = await entered.promise;
  const started = await (await fetch(`${base}/api/render/progress`)).json();
  assert.equal(started.active, true);
  assert.equal(started.phase, 'upload');
  assert.equal(started.progress, 0);
  job.report({phase: 'bundle', progress: 0.5});
  job.report({phase: 'render', progress: 0.4, renderedFrames: 12, totalFrames: 30, etaMs: 6000});
  const running = await (await fetch(`${base}/api/render/progress`)).json();
  assert.deepEqual(running, {active: true, phase: 'render', progress: 0.55, renderedFrames: 12,
    totalFrames: 30, etaMs: 6000, elapsedMs: running.elapsedMs});
  assert.ok(running.elapsedMs >= 0);
  assert.equal(JSON.stringify(running).includes(job.workspace), false,
    'Progress must not expose render workspace paths');
  const busy = await post(base);
  assert.equal(busy.status, 409);
  await busy.json();
  job.report({phase: 'muxing', progress: 1});
  const finishing = await (await fetch(`${base}/api/render/progress`)).json();
  assert.equal(finishing.progress, 1, 'The last stage must close the bar at 100%');
  midRender.resolve();
  const response = await first;
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const idle = await (await fetch(`${base}/api/render/progress`)).json();
  assert.deepEqual(idle, {active: false, phase: 'idle', progress: 0, renderedFrames: 0,
    totalFrames: null, etaMs: null, elapsedMs: 0});
});

test('progress reads stay inside the same local network boundary as renders', async (t) => {
  const base = await studio(t);
  const response = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/render/progress`, {headers: {Host: 'example.org:4317'}}, resolve);
    req.on('error', reject);
    req.end();
  });
  assert.equal(response.statusCode, 403);
  response.resume();
});

async function waitForRemoval(workspace) {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      await access(workspace);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    await delay(10);
  }
  assert.fail('Render workspace was not removed');
}

test('rejects disguised or empty audio before rendering', async (t) => {
  let renders = 0;
  const base = await studio(t, {render: async (job) => { renders++; await render(job); }});
  for (const content of ['#EXTM3U\nhttps://example.org/audio.mp3\n', '']) {
    const response = await post(base, form(project, new Blob([content], {type: 'audio/wav'})));
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /audio/i);
  }
  assert.equal(renders, 0);
});

test('rejects malformed multipart, invalid projects, and client media URLs', async (t) => {
  let renders = 0;
  const base = await studio(t, {render: async (job) => { renders++; await render(job); }});
  const invalidAudio = form();
  invalidAudio.set('audio', 'https://example.org/beep.wav');
  const externalField = form();
  externalField.set('audioSrc', 'https://example.org/beep.wav');
  const duplicateProject = form();
  duplicateProject.append('project', JSON.stringify(project));
  const invalidVideo = form();
  invalidVideo.set('video', 'https://example.org/video.mp4');
  const externalVideo = form();
  externalVideo.set('videoSrc', 'https://example.org/video.mp4');
  const duplicateVideo = form(project, undefined, new Blob(['first']));
  duplicateVideo.append('video', new Blob(['second']), 'second.mp4');
  for (const response of [
    await post(base, 'not multipart'),
    await post(base, 'missing parts', {'Content-Type': 'multipart/form-data; boundary=test'}),
    await post(base, form({...project, durationInFrames: 216001})),
    await post(base, invalidAudio),
    await post(base, externalField),
    await post(base, duplicateProject),
    await post(base, invalidVideo),
    await post(base, externalVideo),
    await post(base, duplicateVideo),
  ]) {
    assert.ok(response.status === 400 || response.status === 415);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal(renders, 0);
});

test('rejects empty video and disguises outside the video demuxer allowlist', async (t) => {
  const cases = {empty: new Blob([]), 'disguised WAV': wav(), corrupt: new Blob(['not a video'], {type: 'video/mp4'})};
  for (const [name, video] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const base = await studio(t, {render: () => assert.fail('Invalid media reached the renderer')});
      const response = await post(base, form(project, undefined, video));
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /video/i);
    });
  }
});

test('rejects oversized audio even when the multipart body fits', async (t) => {
  const base = await studio(t);
  const audio = (size) => new Blob([Buffer.alloc(size)], {type: 'audio/wav'});
  const maxAudio = 25 * 1024 * 1024;
  const overAudio = await post(base, form(project, audio(maxAudio + 1)));
  assert.equal(overAudio.status, 413);
  assert.match((await overAudio.json()).error, /25 MiB/);
});

test('rejects uploads above the video cap or the multipart parser cap', async (t) => {
  const base = await studio(t);
  const maxVideo = 100 * 1024 * 1024;
  const maxBody = 126 * 1024 * 1024;
  const overVideo = await post(base, form(project, undefined, new Blob([Buffer.alloc(maxVideo + 1)])));
  assert.equal(overVideo.status, 413);
  assert.match((await overVideo.json()).error, /100 MiB/);
  const overBody = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/render`, {method: 'POST', headers: {
      'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': maxBody + 1,
    }}, resolve);
    req.on('error', reject);
    req.end();
  });
  assert.equal(overBody.statusCode, 413);
  overBody.resume();
});

test('rejects a second render until the first finishes', async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const base = await studio(t, {render: async (job) => {
    entered.resolve(job.workspace);
    await release.promise;
    await render(job);
  }});
  const first = post(base);
  const workspace = await entered.promise;
  try {
    const second = await post(base);
    assert.equal(second.status, 409);
    assert.match((await second.json()).error, /progress/i);
  } finally {
    release.resolve();
  }
  await (await first).arrayBuffer();
  await waitForRemoval(workspace);
  const retry = await post(base);
  assert.equal(retry.status, 200);
  await retry.arrayBuffer();
});

test('aborts a disconnected render and removes its workspace', async (t) => {
  const entered = Promise.withResolvers();
  const base = await studio(t, {render: async ({signal, workspace}) => {
    entered.resolve(workspace);
    await once(signal, 'abort');
    signal.throwIfAborted();
  }});
  const controller = new AbortController();
  const canceled = assert.rejects(fetch(`${base}/api/render`, {
    method: 'POST', body: form(), signal: controller.signal,
  }), {name: 'AbortError'});
  const workspace = await entered.promise;
  controller.abort();
  await canceled;
  await waitForRemoval(workspace);
});
