// Easing + tham số động port từ src/js/animations.js.
import { Easing } from 'remotion';

// GSAP power-naming: power1=Quad(^2), power2=Cubic(^3), power3=Quart(^4).
export const P2_OUT = Easing.out(Easing.cubic); // 'power2.out'
export const P3_OUT = Easing.out(Easing.poly(4)); // 'power3.out'
export const SINE_INOUT = Easing.inOut(Easing.sin); // 'sine.inOut' (aurora lerp)

export const ACTIVE_SCALE = 1.04;
export const PAST_SCALE = 0.9;
export const EXHALE_RISE = -14; // px: câu rời đi nhích LÊN
export const SOAK_BLUR = 3; // px nhòe ban đầu mỗi ký tự khi "thấm"
export const ENTER_DUR = 1.25;
export const INNER_DUR = 1.1; // word-inner trượt lên
export const INNER_STAGGER = 0.05;
export const SOAK_DUR = 0.95;
export const SOAK_STAGGER = 0.05;
export const REVEAL_DUR = 0.85; // "love" thấm
export const REVEAL_STAGGER = 0.06;
export const PAST_DUR = 1.05; // exhale-out
export const SCROLL_DUR = 1.35; // cuộn recenter

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// progress đã ease cho một animation bắt đầu ở `t0`, kéo dài `dur`, với `delay` (stagger).
export function eased(t: number, t0: number, dur: number, ease: (p: number) => number, delay = 0) {
  return ease(clamp01((t - t0 - delay) / dur));
}

export type PastTarget = { opacity: number; blur: number; scale: number; y: number };

// Trạng thái "đích" của dòng theo khoảng cách d (0 = active rest, >=1 = đã hát lùi xa) — port applyStates/toPast.
export function pastTarget(d: number): PastTarget {
  if (d <= 0) return { opacity: 1, blur: 0, scale: ACTIVE_SCALE, y: 0 };
  return {
    opacity: Math.max(0, 0.62 - (d - 1) * 0.15),
    blur: Math.min(0.6 + (d - 1) * 0.85, 3.4),
    scale: PAST_SCALE,
    y: EXHALE_RISE,
  };
}
