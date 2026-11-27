import assert from 'node:assert/strict';
import test from 'node:test';
import {visibleWaveform, waveformEnvelope, waveformWindow} from '../waveform.mjs';

test('bounded 20Hz envelope exposes normalized amplitudes and time origin', () => {
  const series = waveformEnvelope([0.1, 1.2, -1], 12.5);
  assert.deepEqual(series, {start: 12.5, secondsPerPeak: 0.05, peaks: [0.1, 1, 0]});
  assert.throws(() => waveformEnvelope(new Float32Array(161), 0), /8 seconds/);
});

test('waveform window uses the same strip scale and clips analysis to the audio source', () => {
  assert.deepEqual(waveformWindow({pxPerSec: 100, scrollX: 250}, 100, 3), {start: 2.5, end: 3});
  assert.equal(waveformWindow({pxPerSec: 100, scrollX: 400}, 100, 3), null);
});

test('waveform renders only visible peaks at strip coordinates, independent of pan', () => {
  const peaks = [0.1, 0.2, 0.3, 0.4];
  const first = visibleWaveform(peaks, {start: 0, end: 4}, {pxPerSec: 100, scrollX: 0}, 200);
  assert.deepEqual(first.map(p => p.x), [50, 150]);
  assert.deepEqual(first.map(p => p.amplitude), [0.1, 0.2]);
  const panned = visibleWaveform(peaks, {start: 0, end: 4}, {pxPerSec: 100, scrollX: 200}, 200);
  assert.deepEqual(panned.map(p => p.x), [250, 350]);
  assert.deepEqual(panned.map(p => p.amplitude), [0.3, 0.4]);
});

test('waveform output remains bounded even when given a huge peak array', () => {
  const peaks = new Float32Array(216_000).fill(0.5);
  assert.ok(visibleWaveform(peaks, {start: 0, end: 7200}, {pxPerSec: 400, scrollX: 1_000_000}, 500).length <= 250);
});
