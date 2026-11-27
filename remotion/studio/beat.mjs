// Deterministic, linear-time rhythm evidence from bounded amplitude envelopes.
const empty = () => ({candidates: [], tempoBpm: null, confidence: 0});

export function detectBeatCandidates({peaks, secondsPerPeak, minBpm = 40, maxBpm = 240, minConfidence = 0.7, maxCandidates = 512}) {
  if (!peaks || !Number.isFinite(secondsPerPeak) || secondsPerPeak < 0.025 || secondsPerPeak > 2 ||
      peaks.length > 144000 || peaks.length * secondsPerPeak > 7200 ||
      !Number.isFinite(minBpm) || !Number.isFinite(maxBpm) || minBpm < 1 || maxBpm < minBpm ||
      maxBpm > 600 || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1 ||
      !Number.isInteger(maxCandidates) || maxCandidates < 0 || maxCandidates > 10000) {
    throw new RangeError('Invalid bounded beat analysis options');
  }
  const events = [];
  let maximum = 0;
  for (let i = 0; i < peaks.length; i++) {
    const value = peaks[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Peaks must be finite amplitudes in [0, 1]');
    if (value > maximum) maximum = value;
  }
  if (maximum < 0.02 || peaks.length < 2) return empty();
  const threshold = Math.max(0.02, maximum * 0.2);
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] - (peaks[i - 1] ?? 0) >= threshold && peaks[i] >= (peaks[i + 1] ?? 0)) events.push(i);
  }
  if (events.length < 6) return empty();
  const minLag = Math.ceil(60 / maxBpm / secondsPerPeak);
  const maxLag = Math.floor(60 / minBpm / secondsPerPeak);
  const counts = new Map();
  for (let i = 1; i < events.length; i++) {
    const lag = events[i] - events[i - 1];
    if (lag >= minLag && lag <= maxLag) counts.set(lag, (counts.get(lag) ?? 0) + 1);
  }
  let bestLag = 0;
  let bestCount = 0;
  for (const [lag, count] of counts) {
    if (count > bestCount || (count === bestCount && lag < bestLag)) {
      bestLag = lag;
      bestCount = count;
    }
  }
  const confidence = bestCount / (events.length - 1);
  if (bestCount < 5 || confidence < minConfidence || maxCandidates === 0) return empty();
  const members = [];
  let runStart = 0;
  for (let i = 1; i <= events.length; i++) {
    if (i < events.length && events[i] - events[i - 1] === bestLag) continue;
    if (i - runStart >= 6) members.push(...events.slice(runStart, i));
    runStart = i;
  }
  if (members.length === 0) return empty();
  return {
    candidates: members.slice(0, maxCandidates).map(index => ({time: index * secondsPerPeak, confidence})),
    tempoBpm: 60 / (bestLag * secondsPerPeak),
    confidence,
  };
}
