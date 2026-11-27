import {timeToX, xToTime} from './editor.mjs';
import {FPS} from './project.mjs';

export function moveCue(cues,index,start,duration) {
  const cue=cues[index];
  const delta=start-cue?.start;
  const nextStart=cues[index+1]?.start;
  const startEnd=Math.min(nextStart ?? duration,duration);
  if (!cue || !Number.isFinite(start) || start<0 || start<=(cues[index-1]?.words.at(-1).start ?? -1) ||
      start>=startEnd || (nextStart!=null && cue.words.at(-1).start+delta>=nextStart)) throw Error('Không thể di chuyển dòng qua từ hoặc ranh giới dòng khác.');
  if (delta===0) return cues;
  return cues.map((item,i)=>i===index?{...item,start,words:item.words.map(w=>({...w,start:w.start+delta}))}:item);
}

export function trimCue(cues,index,boundary,duration) {
  const before=cues[index], next=cues[index+1], nextNext=cues[index+2];
  const end=Math.min(nextNext?.start ?? duration,duration);
  if (!before || !next || !Number.isFinite(boundary) || boundary<=before.words.at(-1).start ||
      boundary>=end || (next.words[0].confirmed && boundary!==next.words[0].start) ||
      next.words.slice(1).some(w=>w.start<boundary && w.confirmed))
    throw Error('Ranh giới không thể đè lên từ đã canh hoặc dòng kế tiếp.');
  if (boundary===next.start) return cues;
  return cues.map((cue,i)=>i===index+1?{...cue,start:boundary,words:cue.words.map((w,j)=>({...w,start:j===0?boundary:Math.max(boundary,w.start)}))}:cue);
}

export function splitCue(cues,index,wordIndex) {
  const cue=cues[index];
  if (!cue || cues.length>=1000 || !Number.isInteger(wordIndex) || wordIndex<=0 || wordIndex>=cue.words.length ||
      cue.words[wordIndex].start<=cue.start || cue.words[wordIndex-1].start>=cue.words[wordIndex].start)
    throw Error('Chỉ có thể tách tại ranh giới giữa hai từ có mốc khác nhau.');
  const left=cue.words.slice(0,wordIndex), right=cue.words.slice(wordIndex);
  return [...cues.slice(0,index),{...cue,text:left.map(w=>w.text).join(' '),words:left},
    {...cue,text:right.map(w=>w.text).join(' '),start:right[0].start,words:right},...cues.slice(index+1)];
}

export function snapTime(time,{enabled=false,starts=[],pxPerSec}) {
  if (!enabled) return time;
  const tolerance=8/pxPerSec;
  const cue=starts.reduce((best,start)=>Math.abs(start-time)<Math.abs(best-time)?start:best,Infinity);
  if (Math.abs(cue-time)<=tolerance) return cue;
  const second=Math.round(time);
  if (Math.abs(second-time)<=tolerance) return second;
  return Math.round(time*FPS)/FPS;
}

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
