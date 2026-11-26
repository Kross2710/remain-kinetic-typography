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
  for (let i=index+1;i<right;i++) moved(i,start+(to-start)*(i-index)/(right-index));
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
    return cueStart===cue.start && words.every((w,i)=>w===cue.words[i])?cue:{...cue,start:cueStart,words};
  });
}

export function setCueStart(cues, line, start, duration) {
  const c = cues[line];
  start = round(start);
  const end = cues[line+1]?.start ?? duration;
  if (!c || !Number.isFinite(start) || start < 0 || start <= (cues[line-1]?.start ?? -1) || start >= end || (line > 0 && cues[line-1].words.at(-1).start >= start)) throw Error('Mốc dòng phải sau các từ ở dòng trước và trước dòng sau.');
  return cues.map((c,i) => i === line ? {...c,start,words:distribute(c.text,start,end)} : c);
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

export function validateProject(p) {
  if (!p || !((p.width===720 && p.height===1280) || (p.width===1280 && p.height===720)) || !Number.isInteger(p.durationInFrames) || p.durationInFrames < 1 || p.durationInFrames > MAX_SECONDS*FPS || !Array.isArray(p.cues) || p.cues.length > 1000) throw Error('Project không hợp lệ (tối đa 2 giờ, 1000 dòng).');
  const duration = p.durationInFrames / FPS;
  const cues = p.cues.map((c,i) => {
    if (!c || typeof c.text !== 'string' || !c.text.trim() || c.text.length > 90 || !Number.isFinite(c.start) || c.start < 0 || c.start >= duration || (i > 0 && !(p.cues[i-1]?.start < c.start)) || !Array.isArray(c.words)) throw Error('Dòng chưa hợp lệ: tối đa 90 ký tự, các mốc dòng phải tăng dần.');
    const tokens = parts(c.text);
    if (tokens.length !== c.words.length) throw Error('Số từ không khớp với lời.');
    const end = p.cues[i+1]?.start ?? duration;
    return {text:tokens.join(' '),start:c.start,words:c.words.map((w,j) => {
      if (w?.text !== tokens[j] || !Number.isFinite(w.start) || w.start < c.start || (j > 0 && w.start < c.words[j-1]?.start) || w.start >= end) throw Error('Mốc từ không đúng thứ tự hoặc nằm ngoài dòng.');
      return {text:w.text,start:w.start};
    })};
  });
  const clean={width:p.width,height:p.height,durationInFrames:p.durationInFrames,cues};
  if (p.videoDurationInFrames !== undefined) {
    if (!Number.isInteger(p.videoDurationInFrames) || p.videoDurationInFrames<1 || p.videoDurationInFrames>p.durationInFrames) throw Error('Thời lượng lớp video không hợp lệ.');
    clean.videoDurationInFrames=p.videoDurationInFrames;
  }
  if (p.renderRange !== undefined) clean.renderRange=validateRange(p.renderRange,p.durationInFrames);
  return clean;
}
