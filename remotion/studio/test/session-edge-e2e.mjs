// Edge cases of the browser session and the render job, each one a regression
// guard for a Cursor Bugbot finding on PR #2:
//  - a restored timeline zoom must survive a reload that keeps the same length,
//  - song markers outside the current preview must survive the session store,
//  - 'Huỷ render' must stop a job that was re-attached after a reload,
//  - 'Huỷ render' must stop an export that is still uploading (no job id yet).
// The render is faked here: this file proves the client/server job contract,
// not pixel output (studio:e2e:session and studio:progress do that).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {startStudioServer} from '../server.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'remain-session-edge-'));
const mp4 = Buffer.from('edge case video');
let server;
let browser;
let page;
try {
  const audio = join(scratch, 'dai.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=32', '-y', audio]);
  // A render that never finishes on its own: only a cancel can end it.
  const render = ({outputLocation, signal}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => writeFile(outputLocation, mp4).then(resolve), 120_000);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('render aborted')); });
  });
  server = await startStudioServer({port: 0, dev: true, bindHost: '127.0.0.1', render});
  const {address, port} = server.address();
  const base = `http://${address}:${port}`;

  const status = await ensureBrowser();
  assert.ok('path' in status, JSON.stringify(status));
  browser = await chromium.launch({executablePath: status.path, args: ['--no-sandbox']});
  page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const openTab = name => page.getByRole('tab', {name, exact: true}).click();
  const slider = page.getByRole('slider', {name: 'Vị trí timeline'});
  const exportButton = page.getByRole('button', {name: 'Xuất MP4', exact: true});
  const cancelButton = page.getByRole('button', {name: 'Huỷ render', exact: true});
  const stripWidth = () => page.locator('.lyric-track .track-strip').evaluate(el => el.getBoundingClientRect().width);
  const footer = () => page.locator('footer div[role="status"], footer div[role="alert"]').innerText();

  await page.goto(base);
  await exportButton.waitFor();

  // ---- 1. zoom survives a reload that does not change the timeline length ---
  const fitted = await stripWidth();
  await page.keyboard.press('=');
  await page.keyboard.press('=');
  const zoomed = await stripWidth();
  assert.ok(zoomed > fitted, `zooming in must widen the lane, ${fitted} -> ${zoomed}`);
  await page.waitForTimeout(900);
  await page.reload();
  await exportButton.waitFor();
  const restored = await stripWidth();
  assert.equal(restored, zoomed, 'a same-length reload must keep the saved zoom, not re-fit it');
  await page.getByRole('button', {name: 'Vừa khung', exact: true}).click();
  await page.waitForTimeout(100);
  assert.equal(await stripWidth(), fitted, 'Vừa khung must fit, not replay the saved zoom');

  // ---- 2. markers outside the preview survive the session -------------------
  await openTab('Media');
  await page.locator('#audio-file').setInputFiles(audio);
  await page.locator('.filename').getByText('dai.mp3', {exact: true}).waitFor();
  assert.equal(await slider.getAttribute('max'), '959', 'the 32s track must set the timeline length');
  await openTab('Hiệu ứng');
  await page.getByText('Hiện thanh Verse/Chorus trong video').click();
  await slider.fill('930');
  await page.getByRole('button', {name: 'Thêm đoạn tại playhead'}).click();
  const markers = page.getByRole('list', {name: 'Mốc đoạn nhạc'});
  const marker = markers.getByRole('button', {name: 'Verse · 31.00s', exact: true});
  await marker.waitFor();
  await page.waitForTimeout(900);
  // Removing the long track shrinks the preview below the marker the user placed.
  await openTab('Media');
  await page.getByRole('button', {name: 'Gỡ nhạc', exact: true}).click();
  assert.equal(await slider.getAttribute('max'), '899', 'the timeline must fall back to the demo length');
  await page.waitForTimeout(900);
  await page.reload();
  await exportButton.waitFor();
  await openTab('Hiệu ứng');
  await marker.waitFor({timeout: 10_000});
  assert.equal(await markers.getByRole('listitem').count(), 1, 'the marker past the preview must survive the session');

  // ---- 3. cancel works on a job re-attached after a reload ------------------
  const noDownload = page.waitForEvent('download', {timeout: 5_000}).then(() => 'downloaded', () => 'none');
  await exportButton.click();
  await page.locator('.render-progress').waitFor({timeout: 30_000});
  await page.reload();
  await exportButton.waitFor();
  await page.locator('.render-progress').waitFor({timeout: 30_000});
  await cancelButton.click();
  await page.locator('.render-progress').waitFor({state: 'detached', timeout: 20_000});
  assert.match(await footer(), /huỷ/i, 'the re-attached job must report the cancel');
  assert.equal(await noDownload, 'none', 'a cancelled render must not deliver a video');
  assert.equal(await exportButton.isEnabled(), true, 'the export button must be usable again after a cancel');

  // ---- 4. cancel works while the project is still uploading -----------------
  await page.route('**/api/render', async route => {
    await new Promise(resolve => setTimeout(resolve, 6_000));
    await route.fulfill({status: 202, contentType: 'application/json', body: JSON.stringify({jobId: 'held'})}).catch(() => {});
  });
  await exportButton.click();
  await cancelButton.waitFor();
  await cancelButton.click();
  await page.locator('.render-progress').waitFor({state: 'detached', timeout: 20_000});
  assert.match(await footer(), /Đã huỷ trước khi render bắt đầu/, 'an upload-only export must be cancellable');
  await exportButton.waitFor();
  await page.unroute('**/api/render');

  assert.deepEqual(errors, []);
  console.log('Session edge cases verified: same-length reload kept the zoom (and Vừa khung still fits), a 31.00s marker survived a shortened timeline, and Huỷ render stopped both a re-attached job and an upload-only export.');
} finally {
  await page?.unrouteAll({behavior: 'ignoreErrors'}).catch(() => {});
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
  await rm(scratch, {recursive: true, force: true});
}
