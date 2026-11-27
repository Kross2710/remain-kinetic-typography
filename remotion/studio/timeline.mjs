import {timeToX, xToTime} from './editor.mjs';
import {FPS} from './project.mjs';

// At the editor's minimum scale (10 px/s), a 10s label still fits.
export function tickSteps(pxPerSec) {
  return {seconds: [1, 2, 5, 10].find(step => step * pxPerSec >= 60) ?? 10, frames: pxPerSec >= 100};
}

export function rulerTicks(view, viewportWidth, duration) {
  const {seconds, frames} = tickSteps(view.pxPerSec);
  const major = seconds * FPS;
  const step = frames ? 1 : major;
  const first = Math.ceil(xToTime(view.scrollX, view) * FPS / step) * step;
  const last = Math.floor(Math.min(duration, xToTime(view.scrollX + viewportWidth, view)) * FPS);
  const ticks = [];
  for (let frame = first; frame <= last; frame += step) {
    const time = frame / FPS;
    const x = frame * (view.pxPerSec / FPS);
    if (frame % major === 0) ticks.push({x, label: `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`});
    else ticks.push({x});
  }
  return ticks;
}

// Cues arrive sorted by start. Their right edges are also sorted because each
// width covers the next start or the minimum hit width, whichever is larger.
export function visibleCues(cues, view, viewportWidth, duration, focusedIndex) {
  const start = index => timeToX(cues[index].start, view);
  const end = index => Math.max(start(index) + 28, timeToX(cues[index + 1]?.start ?? duration, view));
  const block = index => ({index, x: start(index), width: end(index) - start(index)});
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (end(mid) <= view.scrollX) lo = mid + 1;
    else hi = mid;
  }
  const blocks = [];
  let index = lo;
  if (focusedIndex >= 0 && focusedIndex < lo) blocks.push(block(focusedIndex));
  for (; index < cues.length && start(index) < view.scrollX + viewportWidth; index++) blocks.push(block(index));
  if (focusedIndex >= index && focusedIndex < cues.length) blocks.push(block(focusedIndex));
  return blocks;
}
