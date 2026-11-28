import {validateEffect,validateMotion,validateSections} from './effects.mjs';
import {isValidPerspectiveCorners} from './perspective.mjs';
import {validateVideoTrack, videoTrackFrames} from './video-track.mjs';

export const FPS = 30;
export const DEMO_SECONDS = 30;
export const MAX_SECONDS = 7200;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const parts = text => text.trim().split(/\s+/u);
const round = n => Math.round(n * 100) / 100;
const stamp = '(\\d{1,3}):([0-5]\\d(?:\\.\\d{1,3})?)';
const seconds = match => Number(match[1]) * 60 + Number(match[2]);
const lineTag = new RegExp(`^\\[${stamp}\\]`);
const wordTag = new RegExp(`<${stamp}>`, 'g');

function distribute(text, start, end) {
  const tokens = parts(text);
  return tokens.map((text, i) => {
    const exact=start+(end-start)*i/tokens.length;
    const snapped=round(exact);
    return {text,start:i===0?start:Math.min(Math.max(snapped,start), snapped>=end?exact:end)};
  });
}

export function importLyrics(source, duration, limit = duration) {
  const rows = source.split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^\[[a-z]+:.*\]$/i.test(s));
  if (!rows.length) throw Error('Nhập ít nhất một dòng lời.');
  const timed = rows.some(s => lineTag.test(s));
  const lines = rows.map((row, i) => {
    if (!timed) return {text:row.replace(/\s+/gu,' '),start:round(i * duration / rows.length)};
    const tag = row.match(lineTag);
    if (!tag) throw Error('Mỗi dòng LRC cần một mốc [phút:giây].');
    const body = row.slice(tag[0].length).trim();
    const hits = [...body.matchAll(wordTag)];
    const words = hits.flatMap((hit, j) => {
      const segment = body.slice(hit.index + hit[0].length, hits[j+1]?.index).trim();
      return segment ? parts(segment).map(text => ({text,start:seconds(hit)})) : [];
    });
    if (hits.length && hits[0].index !== 0) throw Error('Enhanced LRC cần mốc ngay trước từ đầu tiên.');
    return {start:seconds(tag),text: hits.length ? words.map(w=>w.text).join(' ') : body.replace(/\s+/gu,' '),words:words.length ? words : undefined};
  }).filter(c => c.text && c.start < limit).sort((a,b) => a.start-b.start);
  if (!lines.length) throw Error('Không có lời trong giới hạn thời lượng của Studio.');
  const cues = lines.map((c,i) => ({...c, words:c.words ?? distribute(c.text,c.start,lines[i+1]?.start ?? (c.start<duration?duration:limit))}));
  const clean = validateProject({width:720,height:1280,durationInFrames:Math.round(limit*FPS),cues}).cues;
  return clean.map((c,i)=>lines[i].words ? {...c,words:c.words.map(w=>({...w,confirmed:true}))} : c);
}

// Derive the renderable range without changing the editable timings.
export function clipCues(cues, duration) {
  return cues.filter(c=>c.start<duration).map(c=>({...c,words:c.words.map(w=>w.start<duration?w:{...w,start:Math.max(c.start,duration-1e-9)})}));
}

export function setWordStart(cues, line, word, start, duration) {
  if (!cues[line]?.words[word]) throw Error('Chọn một từ để canh mốc.');
  if (!Number.isFinite(start) || start < 0 || start >= duration) throw Error('Mốc phải nằm trong timeline.');
  const orderError = () => Error('Mốc này đè lên một từ đã canh. Hãy tua lại hoặc chọn từ cần sửa.');
  const attachmentError = () => Error('Mốc phải trước điểm kết thúc của dòng gắn clip.');
  const attachmentEnd = cues[line].attachment?.end ?? Infinity;
  if (start>=attachmentEnd) throw attachmentError();
  // An LRC/estimated line boundary is a hint, not a limit on the next tap.
  const flat = cues.flatMap((cue, li) => cue.words.map(w => ({word:w,line:li})));
  const index = cues.slice(0,line).reduce((sum,cue)=>sum+cue.words.length,0)+word;
  let left=index-1;
  let right=index+1;
  while (left>=0 && !flat[left].word.confirmed && flat[left].word.start>=start) left--;
  while (right<flat.length && !flat[right].word.confirmed && flat[right].word.start<=start) right++;
  const before=flat[left];
  const after=flat[right];
  const from=before?.word.start ?? 0;
  const to=after?.word.start ?? duration;
  if (from>start || to<start || (from===start && before && before.line<line) || (to===start && after && after.line>line)) throw orderError();
  const moved=(i,time)=>{flat[i]={...flat[i],word:{...flat[i].word,start:time}};};
  for (let i=left+1;i<index;i++) moved(i,from+(start-from)*(i-left)/(index-left));
  for (let i=index+1;i<right;i++) {
    // An attached line's estimates must fit before its fixed source-clock end.
    const limit=flat[i].line===line?Math.min(to,attachmentEnd):to;
    moved(i,start+(limit-start)*(i-index)/(right-index));
  }
  flat[index].word={...flat[index].word,start,confirmed:true};
  let cursor=0;
  let previousEnd=-1;
  return cues.map(cue=>{
    const words=flat.slice(cursor,cursor+cue.words.length).map(entry=>entry.word);
    const first=words[0].start;
    if (first<=previousEnd) throw orderError();
    const preferred=words[0]!==cue.words[0]?first:cue.start;
    const cueStart=preferred<=previousEnd?previousEnd+(first-previousEnd)/2:preferred;
    previousEnd=words.at(-1).start;
    cursor+=words.length;
    if (cueStart===cue.start && words.every((w,i)=>w===cue.words[i])) return cue;
    if (cue.attachment && previousEnd>=cue.attachment.end) throw attachmentError();
    return {...cue,start:cueStart,words};
  });
}

export function setCueStart(cues, line, start, duration) {
  const c = cues[line];
  start = round(start);
  // Editing only the leading edge keeps an attachment's trailing edge fixed.
  const end = Math.min(cues[line+1]?.start ?? duration,c?.attachment?.end ?? Infinity);
  if (!c || !Number.isFinite(start) || start < 0 || start <= (cues[line-1]?.start ?? -1) || start >= end || (line > 0 && cues[line-1].words.at(-1).start >= start)) throw Error('Mốc dòng phải sau các từ ở dòng trước và trước dòng sau.');
  return cues.map((c,i) => i === line ? {...c,start,words:distribute(c.text,start,end).map((w,j)=>c.words[j].emphasis?{...w,emphasis:true}:w)} : c);
}

export function activeAt(cues, time) {
  const line = cues.findLastIndex(c => c.start <= time);
  return [line, line < 0 ? -1 : cues[line].words.findLastIndex(w => w.start <= time)];
}

export function timelineLength(audioSeconds, videoSeconds) {
  return Math.floor((Math.max(audioSeconds ?? 0, videoSeconds ?? 0) || DEMO_SECONDS) * FPS + 1e-6);
}

function validateRange(range, length) {
  if (!range || !Number.isInteger(range.startFrame) || !Number.isInteger(range.endFrame) || range.startFrame < 0 || range.endFrame > length || range.startFrame >= range.endFrame) {
    throw Error('Mốc bắt đầu phải trước mốc kết thúc và cả hai phải nằm trong timeline.');
  }
  return {startFrame:range.startFrame,endFrame:range.endFrame};
}

export function rangeFromSeconds(start, end, length) {
  if (!String(start).trim() || !String(end).trim() || Number(start)<0) throw Error('Nhập cả mốc bắt đầu và kết thúc hợp lệ.');
  return validateRange({startFrame:Math.round(Number(start)*FPS),endFrame:Math.round(Number(end)*FPS)},length);
}

function validateCuePerspective(perspective) {
  const {corners, aspect} = perspective ?? {};
  if ((aspect !== 'wide' && aspect !== 'tall') || !isValidPerspectiveCorners(corners)) {
    throw Error('Phối cảnh của dòng lời không hợp lệ.');
  }
  return {corners:corners.map(({x,y}) => ({x,y})), aspect};
}

function validateCueAttachment(attachment, start, clipIds) {
  const {end, segments} = attachment ?? {};
  const invalid = () => Error('Liên kết giữa dòng lời và clip không hợp lệ.');
  if (!Number.isFinite(end) || end <= start || end > MAX_SECONDS || !Array.isArray(segments) || !segments.length || segments.length > clipIds.size) throw invalid();
  const seen = new Set();
  const clean = [];
  for (const segment of segments) {
    const {clipId, offsetFrames} = segment ?? {};
    if (!clipIds.has(clipId) || seen.has(clipId) || !Number.isSafeInteger(offsetFrames)) throw invalid();
    seen.add(clipId);
    clean.push({clipId, offsetFrames});
  }
  return {end, segments:clean};
}

export function validateProject(p) {
  if (!p || !((p.width===720 && p.height===1280) || (p.width===1280 && p.height===720)) || !Number.isInteger(p.durationInFrames) || p.durationInFrames < 1 || p.durationInFrames > MAX_SECONDS*FPS || !Array.isArray(p.cues) || p.cues.length > 1000) throw Error('Project không hợp lệ (tối đa 2 giờ, 1000 dòng).');
  const videoTrack = p.videoTrack === undefined ? undefined : validateVideoTrack(p.videoTrack);
  if (videoTrack && videoTrackFrames(videoTrack) > p.durationInFrames) throw Error('Track video dài hơn thời lượng project.');
  const clipIds = new Set(videoTrack?.map(clip => clip.id));
  // Video edits can shorten the composition without changing stored song coordinates.
  const cueLimit = videoTrack === undefined ? p.durationInFrames / FPS : MAX_SECONDS;
  const cues = p.cues.map((c,i) => {
    if (!c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 90 || !Number.isFinite(c.start) || c.start < 0 || c.start >= cueLimit || (i > 0 && !(p.cues[i-1]?.start < c.start)) || !Array.isArray(c.words)) throw Error('Dòng chưa hợp lệ: tối đa 90 ký tự, các mốc dòng phải tăng dần.');
    const tokens = parts(c.text);
    if (tokens.length !== c.words.length) throw Error('Số từ không khớp với lời.');
    const end = p.cues[i+1]?.start ?? cueLimit;
    if(c.effect?.preset==='web-match') throw Error('Web Match chỉ áp dụng cho toàn bộ project.');
    if(c.effect?.motion!==undefined)throw Error('Hiệu ứng chuyển động của dòng phải lưu riêng với preset.');
    if(c.hook!==undefined && typeof c.hook!=='boolean') throw Error('Dấu hook không hợp lệ.');
    const perspective = c.perspective === undefined ? {} : {perspective:validateCuePerspective(c.perspective)};
    const attachment = c.attachment === undefined ? {} : {attachment:validateCueAttachment(c.attachment,c.start,clipIds)};
    return {text:tokens.join(' '),start:c.start,...perspective,...attachment,...(c.motion===undefined?{}:{motion:validateMotion(c.motion,'line')}),...(c.hook===true?{hook:true}:{}),...(c.effect===undefined?{}:{effect:validateEffect(c.effect)}),words:c.words.map((w,j) => {
      if (w?.text !== tokens[j] || !Number.isFinite(w.start) || w.start < c.start || (j > 0 && w.start < c.words[j-1]?.start) || w.start >= end) throw Error('Mốc từ không đúng thứ tự hoặc nằm ngoài dòng.');
      return {text:w.text,start:w.start,...(w.emphasis===true?{emphasis:true}:{})};
    })};
  });
  const clean={width:p.width,height:p.height,durationInFrames:p.durationInFrames,cues};
  if (videoTrack !== undefined) clean.videoTrack = videoTrack;
  if (p.videoDurationInFrames !== undefined) {
    if (!Number.isInteger(p.videoDurationInFrames) || p.videoDurationInFrames<1 || p.videoDurationInFrames>p.durationInFrames) throw Error('Thời lượng lớp video không hợp lệ.');
    clean.videoDurationInFrames=p.videoDurationInFrames;
  }
  if (p.effect !== undefined) clean.effect=validateEffect(p.effect);
  if (p.sections !== undefined) clean.sections=validateSections(p.sections,MAX_SECONDS);
  if (p.showSections === true) clean.showSections=true;
  if (p.renderRange !== undefined) clean.renderRange=validateRange(p.renderRange,p.durationInFrames);
  return clean;
}
