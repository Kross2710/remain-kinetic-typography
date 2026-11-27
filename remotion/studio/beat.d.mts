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
  /** Maximum observed onset candidates returned in chronological order; default 512. */
  maxCandidates?: number;
};
/** Returns only detected onsets in supported runs of >=6; no generated beat grid. */
export function detectBeatCandidates(options: BeatOptions): BeatAnalysis;
