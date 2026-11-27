import assert from 'node:assert/strict';
import test from 'node:test';
import * as timeline from '../timeline.mjs';

test('ruler keeps second labels at least 60px apart and adds frame ticks at close zoom', () => {
  assert.deepEqual([10, 20, 30, 60, 100, 400].map(scale => timeline.tickSteps(scale)), [
    {seconds: 10, frames: false}, {seconds: 5, frames: false}, {seconds: 2, frames: false},
    {seconds: 1, frames: false}, {seconds: 1, frames: true}, {seconds: 1, frames: true},
  ]);
  const ticks = timeline.rulerTicks({pxPerSec: 120, scrollX: 119}, 120, 60);
  assert.deepEqual(ticks.filter(t => t.label), [{x: 120, label: '0:01'}]);
  assert.ok(ticks.some(t => t.x === 124 && !t.label));
  assert.ok(ticks.every(t => t.x >= 119 && t.x <= 239));
  assert.equal(timeline.rulerTicks({pxPerSec: 60, scrollX: 3600}, 60, 60).at(-1).label, '1:00');
  assert.ok(timeline.rulerTicks({pxPerSec: 10, scrollX: 0}, 900, 2).every(t => t.x <= 20));
});

test('visible cues keep their original indexes across pan, including overlapping and focused cues', () => {
  const cues = [0, 1, 2, 3, 8, 18, 50].map(start => ({start}));
  const view = {pxPerSec: 10, scrollX: 51};
  assert.deepEqual(timeline.visibleCues(cues, view, 17, 60), [{index: 3, x: 30, width: 50}]);
  assert.deepEqual(timeline.visibleCues(cues, view, 17, 60, 5), [
    {index: 3, x: 30, width: 50}, {index: 5, x: 180, width: 320},
  ]);
  assert.deepEqual(timeline.visibleCues(cues.slice(0, 4), view, 17, 6), [{index: 3, x: 30, width: 30}]);
  assert.deepEqual(timeline.visibleCues(cues, {pxPerSec: 10, scrollX: 24}, 4, 60).map(c => c.index), [0, 1, 2]);
  assert.deepEqual(timeline.visibleCues([], view, 17, 60), []);
});
