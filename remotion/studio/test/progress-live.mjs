// Live progress check: a real Studio server, a real Chromium render, and the
// progress the browser would actually see. Run with: node studio/test/progress-live.mjs
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
const scratch = await mkdtemp(join(tmpdir(), 'remain-progress-'));
let samples = [];
try {
  const data = new FormData();
  data.set('project', JSON.stringify(project));
  const startedUpload = await fetch(`${base}/api/render`, {method: 'POST', body: data});
  if (startedUpload.status !== 202) throw Error(`Render start failed: ${await startedUpload.text()}`);
  const {jobId} = await startedUpload.json();
  const started = Date.now();
  let job = null;
  while (Date.now() - started < 9 * 60_000) {
    job = await (await fetch(`${base}/api/render/jobs/${jobId}`)).json();
    if (job.status === 'running') samples.push({...job, at: Date.now() - started});
    else break;
    await delay(250);
  }
  if (job?.status !== 'done') throw Error(`Render did not finish: ${JSON.stringify(job)}`);
  const file = await fetch(`${base}/api/render/jobs/${jobId}/file`);
  if (file.status !== 200) throw Error(`Video download failed: ${file.status}`);
  assert.match(file.headers.get('content-type'), /^video\/mp4\b/);
  const clip = new Uint8Array(await file.arrayBuffer());
  await writeFile(join(scratch, 'clip.mp4'), clip);
  const gone = await fetch(`${base}/api/render/jobs/${jobId}`);
  if (gone.status !== 404) throw Error('A downloaded job must be removed from the server');
  await gone.json();

  for (const sample of samples) {
    console.log(`t=${(sample.at / 1000).toFixed(1)}s ${sample.phase} ${Math.round(sample.progress * 100)}%`
      + ` frames=${sample.renderedFrames}/${sample.totalFrames}`
      + ` eta=${sample.etaMs === null ? '-' : `${(sample.etaMs / 1000).toFixed(1)}s`}`);
  }

  assert.ok(samples.length > 3, `Too few progress samples: ${samples.length}`);
  assert.equal(JSON.stringify(samples).includes('remain-studio-'), false,
    'Progress must not leak render workspace paths');

  const phases = new Set(samples.map(sample => sample.phase));
  assert.ok(phases.has('bundle'), `Bundling was never reported: ${[...phases]}`);
  // The frame loop is reported as 'render' for a moment and then as stitchStage
  // 'encoding'; a poll can legitimately miss the handover, so either counts.
  assert.ok(phases.has('render') || phases.has('encoding'),
    `Frame rendering was never reported: ${[...phases]}`);
  // Remotion reports the frame loop as stitchStage 'encoding' and the final
  // audio/video join as 'muxing'; both must be visible to the client.
  assert.ok(phases.has('encoding') || phases.has('muxing'), `Stitching was never reported: ${[...phases]}`);

  const percent = (phase) => samples.filter(s => s.phase === phase).map(s => s.progress);
  assert.ok(percent('bundle').some(p => p > 0 && p <= 1), 'Bundle progress must move between 0 and 1');
  assert.ok(percent('encoding').some(p => p > 0), 'Frame rendering must move above 0');
  // The final stage closes at 100% only when the file is ready, so the last
  // polled value depends on poll cadence; what matters is how far it got.
  assert.ok(Math.max(...samples.map(s => s.progress)) >= 0.85,
    `Progress never approached completion: ${Math.max(...samples.map(s => s.progress))}`);
  for (const phase of phases) {
    const values = percent(phase);
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] >= values[i - 1], `${phase} progress went backwards: ${values}`);
    }
  }
  // The bar the user sees is one scale across stages: it must never walk back.
  const overall = samples.map(s => s.progress);
  for (let i = 1; i < overall.length; i++) {
    assert.ok(overall[i] >= overall[i - 1], `Overall progress went backwards: ${overall}`);
  }
  assert.ok(percent('bundle').every(p => p >= 0.05 && p <= 0.25),
    `Bundling must stay inside its slice of the bar: ${percent('bundle')}`);
  assert.ok(percent('encoding').every(p => p >= 0.25 && p <= 1),
    `Rendering must stay inside its slice of the bar: ${percent('encoding')}`);

  const renderSamples = samples.filter(s => s.phase === 'render' || s.phase === 'encoding' || s.phase === 'muxing');
  assert.ok(renderSamples.every(s => s.totalFrames === 90), 'Render samples must carry the frame count');
  assert.ok(renderSamples.some(s => Number.isFinite(s.etaMs) && s.etaMs > 0),
    'No remaining-time estimate was produced during rendering');
  const eta = renderSamples.filter(s => Number.isFinite(s.etaMs));
  const remaining = eta.map(s => s.etaMs / 1000);
  assert.ok(remaining.every(value => value < 12 * 60), `Implausible ETA: ${remaining}`);
  console.log(`ETA samples (seconds): ${remaining.map(v => v.toFixed(1)).join(', ')}`);

  const meta = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format',
    '-of', 'json', join(scratch, 'clip.mp4')], {encoding: 'utf8'}));
  const video = meta.streams.find(stream => stream.codec_type === 'video');
  assert.deepEqual([video.codec_name, video.width, video.height, video.nb_frames], ['h264', 720, 1280, '90']);
  console.log(`Verified MP4: ${video.codec_name} ${video.width}x${video.height}, ${video.nb_frames} frames, `
    + `${samples.length} progress samples over ${((Date.now() - started) / 1000).toFixed(1)}s.`);
} finally {
  server.close();
  server.closeAllConnections();
  await rm(scratch, {recursive: true, force: true});
}
