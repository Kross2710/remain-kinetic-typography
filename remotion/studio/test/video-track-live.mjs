// Real Studio API export on a private port. Run: node studio/test/video-track-live.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startStudioServer} from '../server.mjs';
import {FPS, MAX_SECONDS} from '../project.mjs';
import {PRESETS} from '../effects.mjs';

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-nostdin', ...args]);
const run = async (base, project, files, expect = 202) => {
  const data = new FormData();
  data.set('project', JSON.stringify(project));
  for (const [key, file] of files) data.append(key, new Blob([file]), 'untrusted-name.mp4');
  const res = await fetch(`${base}/api/render`, {method: 'POST', body: data});
  const result = await res.json();
  assert.equal(res.status, expect, JSON.stringify(result));
  return result;
};

async function download(base, id, target) {
  const url = `${base}/api/render/jobs/${id}`;
  const deadline = Date.now() + 180_000;
  let job;
  do {
    job = await (await fetch(url)).json();
    if (job.status !== 'running') break;
    await delay(250);
  } while (Date.now() < deadline);
  assert.equal(job.status, 'done', JSON.stringify(job));
  const file = await fetch(`${url}/file`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^video\/mp4\b/);
  await writeFile(target, new Uint8Array(await file.arrayBuffer()));
  return job.totalFrames;
}

function checkFrames(output, expected) {
  const {streams} = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]));
  const video = streams.find(stream => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, Number(video.nb_frames)], ['h264', 1280, 720, expected.length]);
  assert.equal(streams.find(stream => stream.codec_type === 'audio')?.codec_name, 'aac');
  const rgb = ffmpeg('-i', output, '-vf', 'crop=2:2:400:320,scale=1:1,format=rgb24', '-an', '-f', 'rawvideo', '-');
  const colors = {red: [1, 0, 0], blue: [0, 0, 1], yellow: [1, 1, 0]};
  assert.equal(rgb.length, expected.length * 3);
  for (const [i, color] of expected.entries()) {
    const pixel = [...rgb.subarray(3 * i, 3 * i + 3)];
    assert.deepEqual(pixel.map(channel => Number(channel > 150)), colors[color], `frame ${i}: ${pixel}`);
    assert.ok(pixel.every((channel, c) => colors[color][c] || channel < 55), `frame ${i}: ${pixel}`);
  }
}

function tone(output) {
  const sampleRate = 48_000;
  const pcm = ffmpeg('-i', output, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 's16le', '-');
  return (frequency, begin, end) => {
    const start = Math.round(begin * sampleRate / FPS);
    const stop = Math.round(end * sampleRate / FPS);
    let real = 0, imaginary = 0;
    for (let i = start; i < stop; i++) {
      const sample = pcm.readInt16LE(2 * i) / 32768;
      const phase = 2 * Math.PI * frequency * i / sampleRate;
      real += sample * Math.cos(phase);
      imaginary += sample * Math.sin(phase);
    }
    return 2 * Math.hypot(real, imaginary) / (stop - start);
  };
}

const scratch = await mkdtemp(join(tmpdir(), 'remain-video-track-'));
let server;
try {
  const sourceA = join(scratch, 'source-a.mp4');
  const sourceB = join(scratch, 'source-b.mp4');
  const music = join(scratch, 'music.wav');
  const output = join(scratch, 'clip.mp4');
  // The inner red/440 Hz region tests trim-in on both streams. Reusing this
  // asset later tests that clips share a file but not trim/mute settings.
  ffmpeg('-f', 'lavfi', '-i', `color=yellow:s=160x90:r=${FPS}:d=0.8,drawbox=color=red:t=fill:enable='gte(t,0.2)*lt(t,0.6)'`,
    '-f', 'lavfi', '-i', "aevalsrc='0.13*sin(2*PI*if(gte(t,0.2)*lt(t,0.6),440,660)*t)':s=48000:d=0.8",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceA);
  ffmpeg('-f', 'lavfi', '-i', `color=blue:s=160x90:r=${FPS}:d=0.8`, '-f', 'lavfi', '-i', 'sine=f=880:r=48000:d=0.8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceB);
  ffmpeg('-f', 'lavfi', '-i', 'sine=f=330:r=48000:d=2', music);
  const project = {width: 1280, height: 720, durationInFrames: 60, cues: [], videoTrack: [
    {id: 'clip-a', mediaId: 'original-a', name: 'source A', sourceFrames: 24, inFrame: 6, outFrame: 18, muted: false},
    {id: 'clip-b', mediaId: 'original-b', name: 'source B', sourceFrames: 24, inFrame: 2, outFrame: 14, muted: true},
    {id: 'clip-c', mediaId: 'original-a', name: 'source A', sourceFrames: 24, inFrame: 18, outFrame: 24, muted: false},
  ]};
  const files = [['clip-original-a', await readFile(sourceA)], ['clip-original-b', await readFile(sourceB)], ['audio', await readFile(music)]];
  server = await startStudioServer({port: 0, bindHost: '127.0.0.1'});
  const base = `http://127.0.0.1:${server.address().port}`;
  const unexpected = await run(base, project, files.slice(0, 1), 400);
  assert.match(unexpected.error, /missing.*original-b/i);
  await run(base, project, [...files, files[0]], 400);
  await run(base, project, [...files, ['clip-extra', files[0][1]]], 400);
  await run(base, project, [...files, ['video', files[0][1]]], 400);
  await run(base, {...project, renderRange: {startFrame: 30, endFrame: 40}}, files, 400);
  const excessive = MAX_SECONDS * FPS + 1;
  const oversized = await run(base, {...project, videoTrack: [{...project.videoTrack[0],
    sourceFrames: excessive, inFrame: excessive - 1, outFrame: excessive}]}, [files[0]], 400);
  assert.match(oversized.error, /preparation limit/i);
  const {jobId} = await run(base, project, files);
  assert.equal(await download(base, jobId, output), 30);
  checkFrames(output, [...Array(12).fill('red'), ...Array(12).fill('blue'), ...Array(6).fill('yellow')]);
  const level = tone(output);
  assert.ok(level(440, 2, 10) > 0.035 && level(660, 2, 10) < 0.009, 'First clip must play the trimmed 440 Hz tone');
  assert.ok(level(880, 14, 22) < 0.009 && level(440, 14, 22) < 0.009, 'Second clip audio must be muted');
  assert.ok(level(660, 25, 29) > 0.035 && level(440, 25, 29) < 0.009, 'The reused source must play its last trim');
  for (const [start, end] of [[2, 10], [14, 22], [25, 29]]) {
    assert.ok(level(330, start, end) > 0.035, 'Soundtrack must mix under both audible and muted clips');
  }
  const range = await run(base, {...project, renderRange: {startFrame: 10, endFrame: 16}}, files);
  assert.equal(await download(base, range.jobId, output), 6);
  checkFrames(output, ['red', 'red', 'blue', 'blue', 'blue', 'blue']);
  const web = await run(base, {...project, effect: PRESETS['web-match'], renderRange: {startFrame: 10, endFrame: 16}}, files);
  assert.equal(await download(base, web.jobId, output), 6);
  checkFrames(output, ['red', 'red', 'blue', 'blue', 'blue', 'blue']);
  console.log('Verified 30-frame H.264/AAC export, frame-exact trims and cuts, repeated media, clip mute, soundtrack mix, 6-frame Classic and Web Match partial exports, and invalid uploads.');
} finally {
  server?.close();
  server?.closeAllConnections();
  await rm(scratch, {recursive: true, force: true});
}
