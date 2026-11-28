import assert from 'node:assert/strict';
import {test} from 'node:test';

const quad = (...points) => points.map(([x, y]) => ({x, y}));
const unit = quad([0, 0], [1, 0], [1, 1], [0, 1]);

test('default perspective is a fresh top-left-first unit rectangle', async () => {
  const {defaultPerspectiveCorners} = await import('../perspective.mjs');
  const first = defaultPerspectiveCorners();
  assert.deepEqual(first, unit);
  first[0].x = 2;
  assert.deepEqual(defaultPerspectiveCorners(), unit);
});

test('validation requires four finite, strictly convex clockwise corners', async () => {
  const {isValidPerspectiveCorners} = await import('../perspective.mjs');
  assert.equal(isValidPerspectiveCorners(unit), true);
  assert.equal(isValidPerspectiveCorners(quad([-1, -2], [1, .1], [1.4, 1], [-.3, 1])), true);
  for (const invalid of [null, unit.slice(0, 3), Array(4), [...unit, unit[0]],
    [...unit].reverse(), [unit[0], unit[2], unit[1], unit[3]],
    quad([0, 0], [1, 0], [.2, .2], [0, 1]), quad([0, 0], [1, 0], [2, 0], [0, 1]),
    quad([0, 0], [1, 0], [1, 1], [1, 1]), [{x: NaN, y: 0}, ...unit.slice(1)],
    [{x: 0, y: Infinity}, ...unit.slice(1)], [{x: '0', y: 0}, ...unit.slice(1)]]) {
    assert.equal(isValidPerspectiveCorners(invalid), false);
  }
});

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

function matrixValues(css) {
  assert.match(css, /^matrix3d\(.+\)$/);
  const m = css.slice(9, -1).split(',').map(Number);
  assert.equal(m.length, 16);
  assert.ok(m.every(Number.isFinite));
  return m;
}

test('CSS homography maps rectangular source pixels to all destination corners in either aspect ratio', async () => {
  const {perspectiveMatrix3d} = await import('../perspective.mjs');
  const cases = [unit, quad([.2, .05], [.9, .1], [.9, .75], [.2, .7]),
    quad([-.12, .12], [.92, -.07], [.76, .91], [.18, 1.09])];
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    for (const corners of cases) {
      const m = matrixValues(perspectiveMatrix3d(corners, width, height));
      unit.forEach(({x, y}, index) => {
        const sx = x * width, sy = y * height;
        const w = m[3] * sx + m[7] * sy + m[15];
        assert.ok(w > 0);
        close((m[0] * sx + m[4] * sy + m[12]) / w, corners[index].x * width);
        close((m[1] * sx + m[5] * sy + m[13]) / w, corners[index].y * height);
      });
    }
  }
});

test('CSS homography returns null for a broken quad or nonpositive/nonfinite dimensions', async () => {
  const {perspectiveMatrix3d} = await import('../perspective.mjs');
  assert.equal(perspectiveMatrix3d([...unit].reverse(), 1280, 720), null);
  for (const dimension of [0, -1, NaN, Infinity]) {
    assert.equal(perspectiveMatrix3d(unit, dimension, 720), null);
    assert.equal(perspectiveMatrix3d(unit, 1280, dimension), null);
  }
});

test('moving all corners preserves shape without clamping to the frame', async () => {
  const {movePerspectiveCorners} = await import('../perspective.mjs');
  assert.deepEqual(movePerspectiveCorners(unit, .5, -.25), quad([.5, -.25], [1.5, -.25], [1.5, .75], [.5, .75]));
  assert.deepEqual(unit, quad([0, 0], [1, 0], [1, 1], [0, 1]));
  assert.equal(movePerspectiveCorners(unit, NaN, 0), null);
});

test('rotation uses preview pixels rather than normalized axes on a non-square frame', async () => {
  const {rotatePerspectiveCorners} = await import('../perspective.mjs');
  const expected = quad([.75, -.5], [.75, 1.5], [.25, 1.5], [.25, -.5]);
  const rotated = rotatePerspectiveCorners(unit, Math.PI / 2, 200, 100);
  rotated.forEach(({x, y}, index) => {
    close(x, expected[index].x);
    close(y, expected[index].y);
  });
  assert.equal(rotatePerspectiveCorners(unit, 0, 200, 0), null);
  assert.equal(rotatePerspectiveCorners(unit, Infinity, 200, 100), null);
});

test('moving one corner updates only that corner and rejects a crossing', async () => {
  const {setPerspectiveCorner} = await import('../perspective.mjs');
  assert.deepEqual(setPerspectiveCorner(unit, 1, {x: .75, y: .25}), quad([0, 0], [.75, .25], [1, 1], [0, 1]));
  assert.deepEqual(unit[1], {x: 1, y: 0});
  assert.equal(setPerspectiveCorner(unit, 1, {x: 0, y: 1}), null);
  assert.equal(setPerspectiveCorner(unit, 4, {x: 0, y: 1}), null);
});
