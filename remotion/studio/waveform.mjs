// A bounded, time-originated envelope for later beat analysis. Callers may
// concatenate adjacent 8s windows; missing windows must never be filled with
// fabricated silence. A 2h track would require 144,000 genuine samples.
export function waveformEnvelope(peaks, start) {
  if (!Number.isFinite(start) || start < 0 || peaks.length > 160) throw Error('Waveform window exceeds 8 seconds');
  return {start, secondsPerPeak: 0.05, peaks: Array.from(peaks, value => Math.min(1, Math.max(0, Number(value) || 0)))};
}

export function waveformWindow(view, viewportWidth, audioSeconds) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(audioSeconds) || audioSeconds <= 0) return null;
  const start = Math.max(0, view.scrollX / view.pxPerSec);
  const end = Math.min(audioSeconds, (view.scrollX + viewportWidth) / view.pxPerSec);
  return end > start ? {start, end} : null;
}

// Peaks are time buckets, not screen pixels. Keep output bounded by screen width.
export function visibleWaveform(peaks, range, view, viewportWidth) {
  const window = waveformWindow(view, viewportWidth, range.end);
  if (!window || !peaks.length || range.end <= range.start) return [];
  const density = peaks.length / (range.end - range.start);
  const first = Math.max(0, Math.floor((Math.max(window.start, range.start) - range.start) * density));
  const last = Math.min(peaks.length, Math.ceil((window.end - range.start) * density));
  const stride = Math.max(1, Math.ceil((last - first) / Math.max(1, Math.floor(viewportWidth / 2))));
  const bars = [];
  for (let i = first; i < last; i += stride) {
    let amplitude = 0;
    for (let j = i; j < Math.min(last, i + stride); j++) amplitude = Math.max(amplitude, peaks[j]);
    bars.push({x: (range.start + (i + Math.min(stride, last - i) / 2) / density) * view.pxPerSec,
      amplitude: Math.min(1, Math.max(0, amplitude))});
  }
  return bars;
}
