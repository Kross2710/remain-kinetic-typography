import assert from 'node:assert/strict';
import {createServer as createHttpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {ensureBrowser} from '@remotion/renderer';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({root, configFile: false, esbuild: {jsx: 'automatic'},
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-perspective-test', import.meta.url)),
  optimizeDeps: {noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime']},
  server: {middlewareMode: true, hmr: false},
  plugins: [{name: 'perspective-fixture', configureServer(vite) {
    vite.middlewares.use('/fixture', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><div id="root"></div><script type="module" src="/test/perspective-fixture.tsx"></script>');
    });
  }}],
});
const http = createHttpServer(server.middlewares);
const unit = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
let browser;
try {
  await new Promise((resolve, reject) => http.once('error', reject).listen(0, '127.0.0.1', resolve));
  const executablePath = process.env.CHROME_PATH ?? (await ensureBrowser()).path;
  browser = await chromium.launch({executablePath, args: ['--no-sandbox']});
  const page = await browser.newPage({viewport: {width: 1000, height: 800}});
  page.setDefaultTimeout(5000);
  await page.goto(`http://127.0.0.1:${http.address().port}/fixture`);
  const preview = page.locator('#preview');
  const overlay = page.getByRole('group', {name: 'Chỉnh phối cảnh video'});
  const state = async () => JSON.parse(await page.locator('#state').innerText());
  const eventually = async (predicate) => {
    const deadline = Date.now() + 2000;
    do {
      const actual = await state();
      if (predicate(actual)) return actual;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    assert.fail(`Unexpected fixture state: ${JSON.stringify(await state())}`);
  };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .005, `${actual} != ${expected}`);
  assert.deepEqual(await overlay.boundingBox(), await preview.boundingBox());
  const box = await preview.boundingBox();
  const to = async (u, v, steps = 4) => page.mouse.move(box.x + u * box.width, box.y + v * box.height, {steps});
  const begin = async (name) => {
    const target = await overlay.getByRole('button', {name, exact: true}).boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
  };
  const reset = () => page.getByRole('button', {name: 'Reset outside overlay'}).click();

  await begin('Di chuyển khung');
  // Release outside the overlay: pointer capture must still commit exactly once.
  await to(1.15, .7);
  const moving = await eventually(s => s.draft !== null);
  assert.equal(moving.commits, 0);
  assert.deepEqual(moving.committed, unit);
  near(moving.draft[0].x, .65);
  near(moving.draft[0].y, .2);
  assert.ok((await page.locator('#video').boundingBox()).x > box.x);
  await page.mouse.up();
  const moved = await eventually(s => s.commits === 1 && s.draft === null);
  assert.deepEqual(moved.committed, moving.draft);
  await reset();

  const corners = ['Góc trên trái', 'Góc trên phải', 'Góc dưới phải', 'Góc dưới trái'];
  const positions = [[.1, .1], [.9, .1], [.9, .9], [.1, .9]];
  for (const [i, corner] of corners.entries()) {
    await begin(corner);
    await to(...positions[i]);
    const dragging = await eventually(s => s.draft !== null);
    dragging.draft.forEach(({x, y}, j) => {
      if (i === j) { near(x, positions[i][0]); near(y, positions[i][1]); }
      else assert.deepEqual({x, y}, unit[j]);
    });
    assert.equal(dragging.commits, 1 + i);
    await page.mouse.up();
    const updated = await eventually(s => s.commits === 2 + i && s.draft === null);
    assert.deepEqual(updated.committed, dragging.draft);
    await reset();
  }

  await begin('Xoay khung');
  // The rotate handle starts above center; move due right to rotate +90°.
  await to(.75, .5);
  const rotating = await eventually(s => s.draft !== null);
  near(rotating.draft[0].x, .75);
  near(rotating.draft[0].y, -.5);
  await page.mouse.up();
  await eventually(s => s.commits === 6 && s.draft === null);
  await reset();

  await begin('Góc trên phải');
  await to(.9, .1);
  const valid = await eventually(s => s.draft !== null);
  await to(.1, .9, 1);
  const invalid = await eventually(s => s.invalid);
  assert.deepEqual(invalid.draft[1], valid.draft[1]);
  await page.mouse.up();
  const reverted = await eventually(s => !s.invalid && s.draft === null);
  assert.deepEqual(reverted.committed, unit);
  assert.equal(reverted.commits, 6);

  await begin('Di chuyển khung');
  await to(.6, .6);
  await eventually(s => s.draft !== null);
  // Simulate lost capture/cancellation while the mouse button is held.
  await overlay.evaluate(el => el.releasePointerCapture(1));
  await to(.65, .6);
  await page.mouse.up();
  const canceled = await eventually(s => s.draft === null);
  assert.equal(canceled.commits, 6);
  assert.deepEqual(canceled.committed, unit);

  await begin('Di chuyển khung');
  await page.mouse.up();
  assert.equal((await state()).commits, 6, 'a click without movement is not a commit');

  const moveHandle = overlay.getByRole('button', {name: 'Di chuyển khung', exact: true});
  await moveHandle.press('Shift+ArrowRight');
  const nudged = await eventually(s => s.commits === 7);
  assert.equal(nudged.draft, null);
  near(nudged.committed[0].x, 10 / box.width);
  await reset();

  await begin('Di chuyển khung');
  await to(.6, .6);
  await eventually(s => s.draft !== null);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await eventually(s => s.commits === 7 && s.draft === null);

  console.log('Perspective editor browser checks passed.');
} finally {
  try { await browser?.close(); } finally {
    await Promise.all([server.close(), new Promise(resolve => http.close(resolve))]);
  }
}
