// Source and timeline offsets are integer project frames; all ends are exclusive.
const clipFrames = ({inFrame, outFrame}) => outFrame - inFrame;
const nonBlank = value => typeof value === 'string' && value.trim().length > 0;

function validateBounds(sourceFrames, inFrame, outFrame) {
  if (!Number.isSafeInteger(sourceFrames) || !Number.isSafeInteger(inFrame) || !Number.isSafeInteger(outFrame) ||
      inFrame < 0 || inFrame >= outFrame || outFrame > sourceFrames) {
    throw Error('Mốc cắt clip phải là các khung hình hợp lệ trong video nguồn.');
  }
}

export function validateVideoTrack(input) {
  if (!Array.isArray(input)) throw Error('Track video không hợp lệ.');
  const ids = new Set();
  const clips = [];
  for (const clip of input) {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip)) throw Error('Clip video không hợp lệ.');
    const {id, mediaId, name, sourceFrames, inFrame, outFrame, muted} = clip;
    if (!nonBlank(id) || ids.has(id) || !nonBlank(mediaId) || !nonBlank(name) || typeof muted !== 'boolean') {
      throw Error('Thông tin clip video không hợp lệ.');
    }
    validateBounds(sourceFrames, inFrame, outFrame);
    ids.add(id);
    clips.push({id, mediaId, name, sourceFrames, inFrame, outFrame, muted});
  }
  return clips;
}

export function clipSpans(clips) {
  let endFrame = 0;
  return clips.map(clip => {
    const startFrame = endFrame;
    endFrame += clipFrames(clip);
    return {...clip, startFrame, endFrame};
  });
}

export function videoTrackFrames(clips) {
  return clips.reduce((frames, clip) => frames + clipFrames(clip), 0);
}

function findClipIndex(clips, id) {
  const index = clips.findIndex(clip => clip.id === id);
  if (index === -1) throw Error('Không tìm thấy clip video.');
  return index;
}

function replaceClip(clips, index, ...replacement) {
  const next = clips.slice();
  next.splice(index, 1, ...replacement);
  return next;
}

export function trimClip(clips, id, inFrame, outFrame) {
  const index = findClipIndex(clips, id);
  const clip = clips[index];
  validateBounds(clip.sourceFrames, inFrame, outFrame);
  if (inFrame === clip.inFrame && outFrame === clip.outFrame) return clips;
  return replaceClip(clips, index, {...clip, inFrame, outFrame});
}

export function splitClip(clips, id, timelineFrame, newId) {
  const index = findClipIndex(clips, id);
  const clip = clips[index];
  const startFrame = videoTrackFrames(clips.slice(0, index));
  if (!Number.isSafeInteger(timelineFrame) || timelineFrame <= startFrame || timelineFrame >= startFrame + clipFrames(clip)) {
    throw Error('Mốc tách phải nằm bên trong clip video.');
  }
  if (!nonBlank(newId) || clips.some(other => other.id === newId)) throw Error('ID clip mới không hợp lệ.');
  const sourceFrame = clip.inFrame + (timelineFrame - startFrame);
  return replaceClip(clips, index, {...clip, outFrame:sourceFrame}, {...clip, id:newId, inFrame:sourceFrame});
}

export function moveClip(clips, id, toIndex) {
  const fromIndex = findClipIndex(clips, id);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= clips.length) throw Error('Vị trí clip không hợp lệ.');
  if (fromIndex === toIndex) return clips;
  const next = clips.slice();
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, clips[fromIndex]);
  return next;
}

export function removeClip(clips, id) {
  return replaceClip(clips, findClipIndex(clips, id));
}

export function muteClip(clips, id, muted) {
  const index = findClipIndex(clips, id);
  const clip = clips[index];
  if (typeof muted !== 'boolean') throw Error('Trạng thái tắt tiếng của clip không hợp lệ.');
  if (muted === clip.muted) return clips;
  return replaceClip(clips, index, {...clip, muted});
}