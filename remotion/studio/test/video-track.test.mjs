import test from 'node:test';
import assert from 'node:assert/strict';

import {clipSpans, videoTrackFrames, validateVideoTrack, trimClip, splitClip, moveClip, removeClip, muteClip} from '../video-track.mjs';
const clip = (overrides = {}) => ({id:'a', mediaId:'asset-a', name:'A.mp4', sourceFrames:100, inFrame:10, outFrame:40, muted:false, ...overrides});

test('clip spans are contiguous and use exclusive ends, independent of source offsets', () => {
  const a = Object.freeze(clip());
  const b = Object.freeze(clip({id:'b', mediaId:'asset-b', inFrame:50, outFrame:70}));
  const clips = Object.freeze([a, b]);
  assert.deepEqual(clipSpans(clips), [{...a, startFrame:0, endFrame:30}, {...b, startFrame:30, endFrame:50}]);
  assert.equal(videoTrackFrames(clips), 50);
  assert.deepEqual(clipSpans([]), []);
  assert.equal(videoTrackFrames([]), 0);
});

test('track validation checks unique clip IDs and absolute source frame bounds', () => {
  assert.deepEqual(validateVideoTrack([]), []);
  const a = clip();
  const b = clip({id:'b', inFrame:0, outFrame:100, muted:true});
  assert.deepEqual(validateVideoTrack([{...a, sourceUrl:'blob:ignored'}, b]), [a, b]);
  for (const invalid of [null, {}, Array(1), [null], [a, a], ...[
    {id:' '}, {mediaId:''}, {name:42}, {sourceFrames:0}, {sourceFrames:Infinity},
    {inFrame:-1}, {inFrame:10.5}, {outFrame:10}, {outFrame:101}, {muted:0},
  ].map(overrides => [clip(overrides)])]) {
    assert.throws(() => validateVideoTrack(invalid), Error);
  }
});

test('trimming uses absolute source frames without mutating the track', () => {
  const a = Object.freeze(clip());
  const b = Object.freeze(clip({id:'b'}));
  const clips = Object.freeze([a, b]);
  const trimmed = trimClip(clips, 'a', 0, 100);
  assert.deepEqual(trimmed[0], {...a, inFrame:0, outFrame:100});
  assert.equal(trimmed[1], b);
  assert.equal(trimClip(clips, 'a', 10, 40), clips);
  assert.throws(() => trimClip(clips, 'a', 40, 40));
  assert.throws(() => trimClip(clips, 'a', 0, 101));
});

test('splitting in timeline coordinates retains both halves’ media identity', () => {
  const a = Object.freeze(clip());
  const b = Object.freeze(clip({id:'b', mediaId:'asset-b', inFrame:60, outFrame:90, muted:true}));
  const clips = Object.freeze([a, b]);
  const split = splitClip(clips, 'b', 45, 'c');
  assert.equal(split[0], a);
  assert.deepEqual(split.slice(1), [{...b, outFrame:75}, {...b, id:'c', inFrame:75}]);
  assert.equal(videoTrackFrames(split), videoTrackFrames(clips));
  for (const frame of [29, 30, 45.5, 60]) assert.throws(() => splitClip(clips, 'b', frame, 'c'));
  assert.throws(() => splitClip(clips, 'b', 45, 'a'));
  assert.throws(() => splitClip(clips, 'b', 45, ' '));
});

test('moving a clip treats the destination as its final zero-based index', () => {
  const clips = Object.freeze([clip(), clip({id:'b'}), clip({id:'c'})]);
  assert.deepEqual(moveClip(clips, 'a', 1), [clips[1], clips[0], clips[2]]);
  assert.deepEqual(moveClip(clips, 'c', 0), [clips[2], clips[0], clips[1]]);
  assert.equal(moveClip(clips, 'b', 1), clips);
  assert.throws(() => moveClip(clips, 'b', 3));
  assert.throws(() => moveClip(clips, 'b', 0.5));
});

test('removing a clip only removes that instance of its source', () => {
  const clips = Object.freeze([clip(), clip({id:'b'})]);
  assert.deepEqual(removeClip(clips, 'a'), [clips[1]]);
  assert.deepEqual(removeClip([clips[0]], 'a'), []);
});

test('muting a clip only affects that instance of its source', () => {
  const clips = Object.freeze([Object.freeze(clip()), Object.freeze(clip({id:'b'}))]);
  const muted = muteClip(clips, 'a', true);
  assert.deepEqual(muted[0], {...clips[0], muted:true});
  assert.equal(muted[1], clips[1]);
  assert.equal(muteClip(muted, 'a', true), muted);
  assert.deepEqual(muteClip(muted, 'a', false), clips);
  assert.throws(() => muteClip(clips, 'a', 1));
});

test('editing a clip that is not on the track rejects the stale ID', () => {
  const clips = [clip()];
  assert.throws(() => trimClip(clips, 'missing', 10, 40), /Không tìm thấy clip/);
  assert.throws(() => splitClip(clips, 'missing', 10, 'c'), /Không tìm thấy clip/);
  assert.throws(() => moveClip(clips, 'missing', 0), /Không tìm thấy clip/);
  assert.throws(() => removeClip(clips, 'missing'), /Không tìm thấy clip/);
  assert.throws(() => muteClip(clips, 'missing', true), /Không tìm thấy clip/);
});
