// Live GPU check: the same project rendered twice through the real Studio server,
// once with the iGPU flag off and once with gpu=1, then compared frame by frame.
// Run with: node studio/test/gpu-live.mjs
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startStudioServer} from '../server.mjs';

const project = {
  width: 720,
  height: 1280,
  durationInFrames: 90,
  cues: [{text: 'Một nhịp thở', start: 0, words: [{text: 'Một', start: 0}, {text: 'nhịp', start: 0.8}, {text: 'thở', start: 1.6}]}],
};

const server = await startStudioServer({port: 0});
const base = `http://127.0.0.1:${server.address().port}`;
const scratch = await mkdtemp(join(tmpdir(), 'remain-gpu-'));

// ffmpeg prints the frame metadata on stderr, so both streams are joined here.
const ffmpegProbe = (name) => {
  const run = spawnSync('ffmpeg', [
    '-hide_banner', '-i', join(scratch, name), '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f', 'null', '-',
  ], {encoding: 'utf8'});
  return `${run.stdout}${run.stderr}`;
};

async function renderClip(label, gpu) {
  const data = new FormData();
  data.set('project', JSON.stringify(project));
  if (gpu) data.set('gpu', '1');
  const startedUpload = await fetch(`${base}/api/render`, {method: 'POST', body: data});
  if (startedUpload.status !== 202) throw Error(`Render start failed: ${await startedUpload.text()}`);
  const {jobId} = await startedUpload.json();
  const started = Date.now();
  let job = null;
  while (Date.now() - started < 9 * 60_000) {
    job = await (await fetch(`${base}/api/render/jobs/${jobId}`)).json();
    if (job.status === 'running') await delay(250);
    else break;
  }
  if (job?.status !== 'done') throw Error(`Render did not finish: ${JSON.stringify(job)}`);
  const file = await fetch(`${base}/api/render/jobs/${jobId}/file`);
  if (file.status !== 200) throw Error(`Video download failed: ${file.status}`);
  const clip = new Uint8Array(await file.arrayBuffer());
  const name = `${label}.mp4`;
  await writeFile(join(scratch, name), clip);
  const wall = Date.now() - started;
  const frames = Number(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(scratch, name),
  ], {encoding: 'utf8'}).trim());
  const luma = /YAVG=([0-9.]+)/.exec(ffmpegProbe(name))?.[1];
  return {wall, fps: +(frames / (wall / 1000)).toFixed(2), frames, bytes: clip.byteLength, luma: +luma};
}

try {
  const cpu = await renderClip('cpu', false);
  const gpu = await renderClip('gpu', true);
  console.log(`cpu: ${cpu.wall}ms ${cpu.fps}fps ${cpu.bytes}B luma=${cpu.luma}`);
  console.log(`gpu: ${gpu.wall}ms ${gpu.fps}fps ${gpu.bytes}B luma=${gpu.luma}`);
  // Both paths must produce the same real video, not a black or empty file.
  assert.equal(gpu.frames, project.durationInFrames);
  assert.ok(gpu.frames > 0 && cpu.frames > 0);
  assert.ok(gpu.luma > 5 && cpu.luma > 5, `black frame: gpu=${gpu.luma} cpu=${cpu.luma}`);
  assert.ok(Math.abs(gpu.luma - cpu.luma) < 8, `the iGPU render changed the picture: ${cpu.luma} vs ${gpu.luma}`);
  const psnrRun = spawnSync('ffmpeg', [
    '-hide_banner', '-i', join(scratch, 'cpu.mp4'), '-i', join(scratch, 'gpu.mp4'), '-lavfi', 'psnr', '-f', 'null', '-',
  ], {encoding: 'utf8'});
  const psnr = /average:([0-9.]+)/.exec(`${psnrRun.stdout}${psnrRun.stderr}`)?.[1];
  console.log(`psnr=${psnr} dB`);
  assert.ok(Number(psnr) > 30, `the iGPU render is not the same picture: psnr=${psnr}`);
  console.log('GPU render check passed');
} finally {
  server.close();
  server.closeAllConnections();
  await rm(scratch, {recursive: true, force: true});
}
