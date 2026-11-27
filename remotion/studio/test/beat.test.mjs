import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectBeatCandidates} from '../beat.mjs';

const pulse = (times, secondsPerPeak = 0.05, duration = 8) => {
  const peaks = Array(Math.ceil(duration / secondsPerPeak)).fill(0);
  for (const time of times) peaks[Math.round(time / secondsPerPeak)] = 0.9;
  return peaks;
};
const train = (start, period, count) => Array.from({length: count}, (_, i) => start + period * i);

test('regular pulses yield observed chronological beat candidates and supported tempo', () => {
  const times = train(0.5, 0.5, 12);
  const result = detectBeatCandidates({peaks: pulse(times), secondsPerPeak: 0.05});
  assert.equal(result.tempoBpm, 120);
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.candidates.map(({time}) => time), times);
  assert.ok(result.candidates.every(({confidence}) => confidence === 1));
});

test('a first-bin pulse at time zero is observed rather than invented or dropped', () => {
  const result = detectBeatCandidates({peaks: pulse(train(0, 0.5, 8)), secondsPerPeak: 0.05});
  assert.deepEqual(result.candidates.map(({time}) => time), train(0, 0.5, 8));
});

test('silence and a single loud transient produce no tempo claim', () => {
  const empty = {candidates: [], tempoBpm: null, confidence: 0};
  assert.deepEqual(detectBeatCandidates({peaks: Array(160).fill(0), secondsPerPeak: 0.05}), empty);
  assert.deepEqual(detectBeatCandidates({peaks: pulse([1]), secondsPerPeak: 0.05}), empty);
});

test('confidence gate suppresses a plausible but noisy pulse train', () => {
  const peaks = pulse([...train(0.5, 0.5, 12), 6.6, 7.1, 7.7]);
  const cautious = detectBeatCandidates({peaks, secondsPerPeak: 0.05, minConfidence: 0.9});
  assert.deepEqual(cautious, {candidates: [], tempoBpm: null, confidence: 0});
  const permissive = detectBeatCandidates({peaks, secondsPerPeak: 0.05, minConfidence: 0.7});
  assert.equal(permissive.candidates.length, 12);
  assert.ok(permissive.confidence >= 0.7 && permissive.confidence < 0.9);
});

test('supported pulses at configured tempo boundaries are included, outside excluded', () => {
  for (const [period, bpm] of [[1.5, 40], [0.25, 240]]) {
    const peaks = pulse(train(0.5, period, 8), 0.05, 14);
    assert.equal(detectBeatCandidates({peaks, secondsPerPeak: 0.05, minBpm: 40, maxBpm: 240}).tempoBpm, bpm);
    assert.equal(detectBeatCandidates({peaks, secondsPerPeak: 0.05, minBpm: bpm + 1, maxBpm: bpm + 20}).tempoBpm, null);
  }
});

test('candidate count is bounded without extrapolating beyond observed pulses', () => {
  const result = detectBeatCandidates({peaks: pulse(train(0.5, 0.5, 15)), secondsPerPeak: 0.05, maxCandidates: 4});
  assert.deepEqual(result.candidates.map(({time}) => time), [0.5, 1, 1.5, 2]);
  assert.equal(result.candidates.length, 4);
});

test('equal evidence chooses the faster quantized interval deterministically', () => {
  const first = train(0.5, 0.75, 8);
  const second = train(7, 0.5, 8);
  const peaks = pulse([...first, ...second], 0.05, 12);
  const result = detectBeatCandidates({peaks, secondsPerPeak: 0.05, minConfidence: 0.4});
  assert.equal(result.tempoBpm, 120);
  assert.deepEqual(result.candidates.map(({time}) => time), second);
  assert.deepEqual(detectBeatCandidates({peaks, secondsPerPeak: 0.05, minConfidence: 0.4}), result);
});

test('invalid amplitudes, impossible resolution and overlong envelopes fail closed', () => {
  for (const peaks of [[0, NaN], [-1, 0], [1.01], Array(144001).fill(0)]) {
    assert.throws(() => detectBeatCandidates({peaks, secondsPerPeak: 0.05}), RangeError);
  }
  assert.throws(() => detectBeatCandidates({peaks: [0], secondsPerPeak: 0}), RangeError);
  assert.throws(() => detectBeatCandidates({peaks: Array(3601).fill(0), secondsPerPeak: 2}), RangeError);
});

test('two-hour, 20 Hz envelope stays bounded without reading PCM', () => {
  const peaks = new Float32Array(144000);
  for (let i = 10; i < peaks.length; i += 10) peaks[i] = 0.9;
  const result = detectBeatCandidates({peaks, secondsPerPeak: 0.05});
  assert.equal(result.tempoBpm, 120);
  assert.equal(result.candidates.length, 512);
  assert.equal(result.candidates[0].time, 0.5);
});

test('late visible window filters observed onsets before candidate cap while retaining global confidence', () => {
  const peaks = new Float32Array(144000);
  for (let i = 10; i < peaks.length; i += 10) peaks[i] = 0.9;
  const result = detectBeatCandidates({
    peaks, secondsPerPeak: 0.05, startTime: 7180, endTime: 7182, maxCandidates: 3,
  });
  assert.deepEqual(result, {
    candidates: [7180, 7180.5, 7181].map(time => ({time, confidence: 1})),
    tempoBpm: 120, confidence: 1,
  });
});

test('visible window includes exact bin boundaries despite floating-point conversion', () => {
  const peaks = pulse(train(0, 0.3, 10));
  const result = detectBeatCandidates({peaks, secondsPerPeak: 0.05, startTime: 0.3, endTime: 0.6});
  assert.equal(result.candidates.length, 2);
  assert.ok(Math.abs(result.candidates[0].time - 0.3) < 1e-9);
  assert.ok(Math.abs(result.candidates[1].time - 0.6) < 1e-9);
});

test('empty visible window never extrapolates beats but retains whole-envelope tempo confidence', () => {
  const result = detectBeatCandidates({
    peaks: pulse(train(0.5, 0.5, 12)), secondsPerPeak: 0.05, startTime: 0.6, endTime: 0.9,
  });
  assert.deepEqual(result, {candidates: [], tempoBpm: 120, confidence: 1});
});

test('invalid visible windows fail closed', () => {
  const peaks = pulse(train(0.5, 0.5, 12));
  for (const window of [
    {startTime: -1, endTime: 2}, {startTime: 2, endTime: 1},
    {startTime: NaN}, {endTime: Infinity},
  ]) assert.throws(() => detectBeatCandidates({peaks, secondsPerPeak: 0.05, ...window}), RangeError);
});

test('isolated transient doublets do not imply a beat train', () => {
  const times = [0.5, 1, 2.6, 3.1, 4.8, 5.3, 7.1, 7.6, 9.5, 10, 12, 12.5];
  assert.deepEqual(detectBeatCandidates({peaks: pulse(times, 0.05, 14), secondsPerPeak: 0.05, minConfidence: 0.5}), {
    candidates: [], tempoBpm: null, confidence: 0,
  });
});
