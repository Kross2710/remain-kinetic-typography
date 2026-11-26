// UI progress check: drives the real Studio page in a browser and reads what
// the user would see while a render runs. Run with: node studio/test/progress-ui.mjs
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';

const base = process.env.STUDIO_TEST_URL ?? 'http://127.0.0.1:4317';
const browser = await chromium.launch({
  executablePath: (await ensureBrowser()).path, args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}, acceptDownloads: true});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', {name: 'Xuất MP4', exact: true}).waitFor();

  await page.locator('#lyrics').fill('Một nhịp thở');
  await page.getByRole('button', {name: 'Áp dụng lời'}).click();
  await page.getByLabel('Phạm vi xuất').selectOption('range');
  await page.getByLabel('Bắt đầu (giây)').fill('0');
  await page.getByLabel('Kết thúc (giây)').fill('3');
  assert.equal(await page.locator('#render-duration').textContent(), '3.00s');
  assert.equal(await page.locator('.render-progress').count(), 0, 'No progress before the render starts');

  const download = page.waitForEvent('download', {timeout: 4 * 60_000});
  await page.getByRole('button', {name: /^Xuất MP4|^Đang render/}).click();

  const samples = [];
  let shot = '';
  const read = async () => {
    const block = page.locator('.render-progress');
    if (!await block.count()) return null;
    return {
      text: await block.locator('span').textContent(),
      value: await block.locator('progress').evaluate(el => el.value),
      button: await page.getByRole('button', {name: /^Đang render/}).getAttribute('data-slot'),
    };
  };
  let done = false;
  download.then(() => { done = true; }).catch(() => { done = true; });
  const started = Date.now();
  while (!done && Date.now() - started < 4 * 60_000) {
    const sample = await read();
    if (sample) samples.push(sample);
    if (!shot && sample && sample.value >= 40) {
      shot = join(tmpdir(), 'remain-progress-panel.png');
      await page.locator('.export-options').screenshot({path: shot});
    }
    await delay(300);
  }
  const event = await download;
  assert.match(event.suggestedFilename(), /\.mp4$/);

  for (const sample of samples) console.log(`bar=${sample.value}%  ${sample.text}`);
  assert.ok(samples.length > 3, `Too few UI samples: ${samples.length}`);
  assert.ok(samples.some(s => /\d+%/.test(s.text)), 'The panel never showed a percentage');
  assert.ok(samples.some(s => /\d+\/\d+ khung/.test(s.text)), 'The panel never showed rendered frames');
  assert.ok(samples.some(s => /còn ~\d+ (giây|phút)/.test(s.text)), 'The panel never showed remaining time');
  assert.ok(samples.some(s => s.button === 'button'), 'The export button never showed its own percentage');
  const percents = samples.map(s => s.value);
  // The last stage only closes at 100% when the file is ready, so the final
  // visible value depends on poll cadence; what matters is how far it got.
  assert.ok(Math.max(...percents) >= 70, `Bar never approached completion: ${Math.max(...percents)}`);
  for (let i = 1; i < percents.length; i++) {
    assert.ok(percents[i] >= percents[i - 1], `Bar went backwards: ${percents}`);
  }
  assert.equal(await page.locator('.render-progress').count(), 0, 'Progress must clear after the render');

  // Cancelling must stop the job, clear the bar and produce no file.
  await page.getByLabel('Kết thúc (giây)').fill('30');
  const cancel = page.getByRole('button', {name: 'Huỷ render'});
  assert.equal(await cancel.count(), 0, 'No cancel button while nothing is rendering');
  await page.getByRole('button', {name: /^Xuất MP4|^Đang render/}).click();
  await page.locator('.render-progress').waitFor();
  await cancel.waitFor();
  await delay(1500);
  const strayDownload = await Promise.race([
    page.waitForEvent('download', {timeout: 3000}).then(() => true, () => false),
    delay(3100).then(() => false),
  ]);
  assert.equal(strayDownload, false, 'A cancelled render must not deliver a file');
  await cancel.click();
  await cancel.waitFor({state: 'hidden', timeout: 30_000});
  assert.equal(await page.locator('.render-progress').count(), 0, 'Cancelling must clear the progress panel');
  assert.match(await page.locator('footer div').textContent(), /Đã huỷ render/);

  assert.deepEqual(errors, []);
  console.log(`UI verified: ${samples.length} samples, bar ${percents[0]}% -> ${Math.max(...percents)}%, `
    + `download ${event.suggestedFilename()}, then cancelled a second render.`);
  console.log(`Panel screenshot: ${shot}`);
} finally {
  await browser.close();
}
