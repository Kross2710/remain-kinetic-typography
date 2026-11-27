import {clipSpans} from './video-track.mjs';

export function attachCue(cues, index, clips, clipId, duration) {
  const cue = cues[index];
  if (!cue) throw Error('Chọn một dòng lời để gắn vào clip.');
  if (cue.attachment) return cues;
  const clip = clipSpans(clips).find(clip => clip.id === clipId);
  if (!clip) throw Error('Không tìm thấy clip video.');
  const end = cues[index + 1]?.start ?? duration;
  if (!Number.isFinite(end) || end <= cue.start) throw Error('Mốc kết thúc dòng không hợp lệ.');
  const attachment = {end, segments:[{clipId, offsetFrames:clip.inFrame - clip.startFrame}]};
  return cues.map((item, i) => i === index ? {...cue, attachment} : item);
}

export function detachCue(cues, index) {
  if (!cues[index]?.attachment) return cues;
  const {attachment, ...cue} = cues[index];
  return cues.map((item, i) => i === index ? cue : item);
}

export function splitCueAttachments(cues, oldId, newId) {
  let changed = false;
  const next = cues.map(cue => {
    const {attachment} = cue;
    if (!attachment) return cue;
    const segment = attachment.segments.find(segment => segment.clipId === oldId);
    if (!segment || attachment.segments.some(segment => segment.clipId === newId)) return cue;
    changed = true;
    return {...cue, attachment:{...attachment, segments:[...attachment.segments, {...segment, clipId:newId}]}};
  });
  return changed ? next : cues;
}

export function removeCueAttachments(cues, clipId) {
  let changed = false;
  const next = [];
  for (const cue of cues) {
    const {attachment} = cue;
    if (!attachment?.segments.some(segment => segment.clipId === clipId)) {
      next.push(cue);
      continue;
    }
    changed = true;
    const segments = attachment.segments.filter(segment => segment.clipId !== clipId);
    if (segments.length) next.push({...cue, attachment:{...attachment, segments}});
  }
  return changed ? next : cues;
}

export function activeSceneCues(cues, clips, frame, fps) {
  const spans = clipSpans(clips ?? []);
  const currentClip = spans.find(clip => frame >= clip.startFrame && frame < clip.endFrame);
  const songEnd = (spans.at(-1)?.endFrame ?? Infinity) / fps;
  const songTime = frame / fps;
  const songIndex = cues.findLastIndex(cue => !cue.attachment && cue.start <= songTime);
  const active = [];
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    if (index === songIndex && songTime < songEnd) {
      const nextSongCue = cues.find((next, i) => i > index && !next.attachment);
      const end = Math.min(nextSongCue?.start ?? Infinity, songEnd);
      active.push({cue, index, time:songTime, end});
    } else if (cue.attachment && currentClip) {
      const segment = cue.attachment.segments.find(segment => segment.clipId === currentClip.id);
      if (!segment) continue;
      const sourceFrame = currentClip.inFrame + (frame - currentClip.startFrame);
      const time = (sourceFrame - segment.offsetFrames) / fps;
      const {end} = cue.attachment;
      // The clip gates visibility; the stored end keeps animation phases continuous across a split.
      if (time >= cue.start && time < end) active.push({cue, index, time, end});
    }
  }
  return active;
}