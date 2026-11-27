export type BeatCandidate = {time: number; confidence: number};
export type BeatAnalysis = {
  candidates: BeatCandidate[];
  /** Quantized tempo hypothesis only when evidence passes the confidence gate. */
  tempoBpm: number | null;
  /** 0 if unsupported; otherwise matching adjacent intervals / all adjacent intervals. */
  confidence: number;
};
export type BeatOptions = {
  /** Bounded, normalized [0, 1] per-bin amplitudes; no full-resolution PCM. Max 144,000 bins / 2 hours. */
  peaks: ArrayLike<number>;
  /** Time per amplitude bin, 0.025–2 seconds. The first bin starts at time zero. */
  secondsPerPeak: number;
  /** Accepted tempo search interval, inclusive, default 40–240 BPM. */
  minBpm?: number;
  maxBpm?: number;
  /** Suppress unsupported detections; default 0.7. Snap UX remains OFF by default. */
  minConfidence?: number;
  /** Inclusive visible start in seconds from the full envelope's time zero; default 0. */
  startTime?: number;
  /** Inclusive visible end in seconds; default peaks.length * secondsPerPeak. */
  endTime?: number;
  /** Maximum observed onset candidates returned in chronological order AFTER window filtering; default 512. */
  maxCandidates?: number;
};
/**
 * Analyze the full bounded envelope for tempo/confidence, then return only observed onsets
 * inside [startTime, endTime] in supported runs of >=6, capped by maxCandidates.
 * Supply the full envelope and the current visible timeline window to snap late in long songs;
 * never infer a beat grid outside observed onsets. A window with no onsets may still have
 * globally supported tempo/confidence. Omit the window for the original whole-envelope result.
 */
export function detectBeatCandidates(options: BeatOptions): BeatAnalysis;
