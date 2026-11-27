import assert from 'node:assert/strict';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';
import {execFileSync} from 'node:child_process';

const server = await startStudioServer({port: 0, dev: true, bindHost: '127.0.0.1'});
let browser;
try {
  const status = await ensureBrowser();
  assert.ok('path' in status);
  browser = await chromium.launch({executablePath: status.path, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const bars = page.locator('.audio-track .waveform-bar');
  assert.equal(await bars.count(), 0, 'No audio never shows a waveform');
  const wav = Buffer.alloc(44 + 4 * 22050 * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 22050; i++) wav.writeInt16LE(Math.round(21000 * Math.sin(i * 2 * Math.PI * 440 / 22050)), 44 + i * 2);
  await page.locator('#audio-file').setInputFiles({name: 'tone.wav', mimeType: 'audio/wav', buffer: wav});
  await bars.first().waitFor();
  assert.ok(await bars.count() >= 70, 'Short visible audio produces a genuine 20Hz envelope');
  const viewport = page.locator('.timeline-viewport');
  const before = await bars.evaluateAll(nodes => nodes.map(node => ({x: node.getBoundingClientRect().x, height: node.getBoundingClientRect().height})));
  assert.ok(before.some(p => p.height > 4), 'Waveform shows nonzero audio energy');
  const scale = await page.locator('.track-strip').evaluate(el => el.getBoundingClientRect().width / 30);
  const left = await viewport.evaluate(el => el.getBoundingClientRect().left);
  const firstX = await bars.first().evaluate(el => el.getBoundingClientRect().left);
  assert.ok(firstX >= left && firstX - left < 4 * scale, 'Waveform is inside the audio lane on the shared scale');
  for (let i = 0; i < 7; i++) await page.getByRole('button', {name: 'Phóng to timeline'}).click();
  const aligned = await bars.first().evaluate(el => ({barX: Number.parseFloat(el.style.left),
    clipWidth: Number.parseFloat(document.querySelector('.audio-track .timeline-media-clip').style.width)}));
  assert.ok(Math.abs(aligned.barX / aligned.clipWidth - 0.025 / 4) < 0.01,
    'Zoom keeps the first 20Hz peak at its source-time position on the audio clip');
  const beforePan = await page.evaluate(() => {
    const bar = [...document.querySelectorAll('.audio-track .waveform-bar')].find(el => Number.parseFloat(el.style.left) > 100);
    return {key: bar.style.left, bar: bar.getBoundingClientRect().x,
      clip: document.querySelector('.audio-track .timeline-media-clip').getBoundingClientRect().x};
  });
  await viewport.evaluate(el => { el.scrollLeft = 50; });
  const afterPan = await page.evaluate(key => {
    const bar = [...document.querySelectorAll('.audio-track .waveform-bar')].find(el => el.style.left === key);
    return {bar: bar.getBoundingClientRect().x,
      clip: document.querySelector('.audio-track .timeline-media-clip').getBoundingClientRect().x};
  }, beforePan.key);
  assert.ok(Math.abs((afterPan.bar - beforePan.bar) - (afterPan.clip - beforePan.clip)) < 1,
    'Native pan moves the same peak and audio clip by exactly the same distance');
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(300);
  const clipped = await viewport.evaluate(el => ({scroll:el.scrollLeft,
    bars:[...el.querySelectorAll('.audio-track .waveform-bar')].map(bar => Number.parseFloat(bar.style.left))}));
  assert.ok(clipped.bars.length > 0 && clipped.bars.length < 70 && clipped.bars.every(x => x + 12 >= clipped.scroll),
    `Pan mounts only visible peaks (allowing a half-bucket at the edge): ${JSON.stringify({scroll:clipped.scroll,count:clipped.bars.length,first:clipped.bars[0]})}`);
  await viewport.evaluate(el => { el.scrollLeft = 0; });
  await bars.first().waitFor();
  await page.waitForTimeout(900); // Debounced session save must finish before reload.
  await page.reload();
  await bars.first().waitFor();
  await page.getByRole('tab', {name: 'Media', exact: true}).click();
  const silent = Buffer.from(wav);
  silent.fill(0, 44);
  await page.locator('#audio-file').setInputFiles({name: 'silence.wav', mimeType: 'audio/wav', buffer: silent});
  await page.waitForFunction(() => !document.querySelector('.audio-track .waveform-bar'));
  await bars.first().waitFor();
  assert.ok((await bars.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).every(height => height <= 4),
    'Replacement clears the old peaks and analyzes only the new silent source');
  await page.getByRole('button', {name: 'Gỡ nhạc'}).click();
  assert.equal(await bars.count(), 0, 'Removing audio cancels and clears peaks');
  const video = execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=2',
    '-f','lavfi','-i','sine=frequency=600:duration=2','-map','0:v','-map','1:a',
    '-c:v','libx264','-threads','1','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
  await page.locator('#video-file').setInputFiles({name:'soundtrack.mp4',mimeType:'video/mp4',buffer:video});
  await page.locator('.video-track .timeline-media-clip').waitFor();
  assert.equal(await bars.count(), 0, 'Video soundtrack alone must not create a music waveform');
  assert.deepEqual(errors, []);
  console.log('Waveform verified: audio-only display, strip alignment, zoom/pan, reload and removal.');
} finally {
  await browser?.close();
  server.close();
  server.closeAllConnections();
}
