import assert from 'node:assert/strict';
import test from 'node:test';
import * as timeline from '../timeline.mjs';

const cues = [
  {text:'one two',start:1,words:[{text:'one',start:1,confirmed:true},{text:'two',start:2,emphasis:true}]},
  {text:'three four',start:4,words:[{text:'three',start:4},{text:'four',start:5,confirmed:true}]},
  {text:'five',start:8,words:[{text:'five',start:8}]},
];

test('moving a cue translates its words and retains editing marks without changing neighbors', () => {
  const moved=timeline.moveCue(cues,1,5,10);
  assert.deepEqual(moved[1].words.map(w=>w.start),[5,6]);
  assert.equal(moved[1].start,5);
  assert.equal(moved[1].words[1].confirmed,true);
  assert.equal(moved[0],cues[0]);
  assert.equal(moved[2],cues[2]);
  assert.throws(()=>timeline.moveCue(cues,1,2,10));
  assert.throws(()=>timeline.moveCue(cues,1,7.5,10));
});

test('right-edge trim moves the next cue start and preserves valid word timing', () => {
  const trimmed=timeline.trimCue(cues,0,3.5,10);
  assert.equal(trimmed[1].start,3.5);
  assert.equal(trimmed[1].words[0].start,3.5);
  assert.equal(trimmed[1].words[1].start,5);
  assert.equal(trimmed[1].words[1].confirmed,true);
  assert.equal(trimmed[0],cues[0]);
  assert.throws(()=>timeline.trimCue(cues,0,1.5,10));
  assert.throws(()=>timeline.trimCue(cues,2,9,10));
});

test('split at a word boundary preserves word marks and cue effect', () => {
  const source=[{...cues[0],effect:{preset:'classic'}},...cues.slice(1)];
  const split=timeline.splitCue(source,0,1);
  assert.deepEqual(split.slice(0,2).map(c=>[c.text,c.start,c.words.length]),[['one',1,1],['two',2,1]]);
  assert.equal(split[0].words[0].confirmed,true);
  assert.equal(split[1].words[0].emphasis,true);
  assert.deepEqual(split[1].effect,source[0].effect);
  assert.equal(split[2],source[1]);
  assert.throws(()=>timeline.splitCue(source,0,0));
  assert.throws(()=>timeline.splitCue(source,2,1));
});

test('snapping is opt-in and prioritizes nearby cue starts then seconds grid then frames', () => {
  const starts=[1,4,8];
  assert.equal(timeline.snapTime(3.96,{enabled:false,starts,pxPerSec:100}),3.96);
  assert.equal(timeline.snapTime(3.96,{enabled:true,starts,pxPerSec:100}),4);
  assert.equal(timeline.snapTime(6.04,{enabled:true,starts,pxPerSec:100}),6);
  assert.equal(timeline.snapTime(6.21,{enabled:true,starts,pxPerSec:100}),Math.round(6.21*30)/30);
});

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
