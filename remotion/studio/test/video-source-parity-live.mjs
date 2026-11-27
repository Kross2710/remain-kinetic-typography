// Real Studio preview and downloaded render of a source on a different frame grid.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';

const ffmpeg = (args, input) => execFileSync('ffmpeg', ['-v', 'error', '-filter_threads', '1', ...args], {input});
const scratch = await mkdtemp(join(tmpdir(), 'remain-video-parity-'));
let server, browser;
try {
  const source = join(scratch, 'coded-24.mp4');
  const pixels = 160 * 90;
  const stride = pixels * 3 / 2;
  const yuv = Buffer.alloc(stride * 8, 128);
  for (let n = 0; n < 8; n++) yuv.fill(30 + 8 * n, n * stride, n * stride + pixels);
  ffmpeg(['-f', 'rawvideo', '-pixel_format', 'yuv420p', '-video_size', '160x90', '-framerate', '24',
    '-i', '-', '-c:v', 'libx264', '-threads', '1', '-crf', '0', source], yuv);
  server = await startStudioServer({port: 0, bindHost: '127.0.0.1', dev: true});
  browser = await chromium.launch({executablePath: (await ensureBrowser()).path, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const button = name => page.getByRole('button', {name, exact: true});
  await button('Project video mới').click();
  await page.getByRole('combobox', {name: 'Khung hình'}).selectOption('wide');
  await page.locator('#video-clips-file').setInputFiles(source);
  await page.getByLabel('Khung đầu', {exact: true}).waitFor();
  await page.getByLabel('Khung đầu', {exact: true}).fill('1');
  await page.getByLabel('Khung cuối', {exact: true}).fill('2');
  await button('Áp dụng cắt').click();
  await page.waitForFunction(() => document.querySelector('#timeline')?.max === '0' &&
    [...document.querySelectorAll('.stage video')].some(video => video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 1 / 30) < 0.001));
  const screenshot = await page.locator('.stage > div').screenshot();
  const sample = 'scale=160:90,format=rgb24,crop=1:1:40:20';
  const preview = [...ffmpeg(['-f', 'image2pipe', '-i', '-', '-vf', sample, '-f', 'rawvideo', '-'], screenshot)];
  assert.equal(preview.length, 3);
  assert.ok(preview.every(channel => Math.abs(channel - 16) <= 2), `Preview must show source frame 0: ${preview}`);
  const download = page.waitForEvent('download', {timeout: 120_000});
  await button('Xuất MP4').click();
  const file = await (await download).path();
  const rendered = [...ffmpeg(['-i', file, '-vf', sample, '-an', '-f', 'rawvideo', '-'])];
  assert.equal(rendered.length, 3, 'The half-open trim exports one composition frame');
  console.log(`24fps source trim [1,2): preview RGB ${preview}; export RGB ${rendered}`);
  assert.ok(rendered.every((channel, i) => Math.abs(channel - preview[i]) <= 2), 'Export must show the same source frame as preview');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(scratch, {recursive: true, force: true});
}
