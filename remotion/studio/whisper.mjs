const clamp01=x=>Math.min(1,Math.max(0,x));
export const whisperEase=x=>{const p=clamp01(x);return p*p*(3-2*p);};

// Rise is a fraction of the short canvas edge, not a fixed pixel offset.
const depths=[
  {rise:0,scale:1,opacity:1,blur:0},
  {rise:.17,scale:.9,opacity:.3,blur:.5},
  {rise:.33,scale:.82,opacity:.12,blur:2},
];
const mix=(a,b,p)=>p===1?b:a+(b-a)*p;
// Match activeAt's time comparison even when multiplying a frame-derived
// timestamp by fps introduces rounding (for example (31 / 30) * 30).
export const firstWhisperFrame=(start,fps)=>{
  const frame=Math.round(start*fps);
  return frame/fps>=start?frame:frame+1;
};

export function whisperStack(cues,line,frame,fps) {
  const result=[];
  for(let index=Math.max(0,line-2);index<line;index++){
    const depth=line-index;
    const crossed=firstWhisperFrame(cues[index+1].start,fps);
    // No composition frame ever showed this cue (several timestamps can
    // fit between frames). Don't paint it for the first time as history.
    if(crossed<=firstWhisperFrame(cues[index].start,fps))continue;
    const p=whisperEase((frame-firstWhisperFrame(cues[line].start,fps))/Math.max(1,Math.round(fps*.62)));
    const prior=cues[line-1];
    const previousProgress=whisperEase((firstWhisperFrame(cues[line].start,fps)-1-firstWhisperFrame(prior.start,fps))/Math.max(1,Math.round(fps*.62)));
    const origin=depth===1?depths[0]:blend(depths[0],depths[1],previousProgress);
    const pose=blend(origin,depths[depth],p);
    // Fade the oldest out before replacing it, so the active +2 limit
    // never needs a fourth line just to hide an abrupt cut.
    if(depth===2 && cues[line+1]){
      const framesLeft=firstWhisperFrame(cues[line+1].start,fps)-1-frame;
      const lifetime=firstWhisperFrame(cues[line+1].start,fps)-firstWhisperFrame(cues[line].start,fps);
      const fadeFrames=Math.min(Math.round(.3*fps),Math.max(1,Math.floor(lifetime/2)));
      pose.opacity*=whisperEase(framesLeft/fadeFrames);
    }
    result.push({index,time:(crossed-1)/fps,pose});
  }
  return result;
}

function blend(from,to,p){
  return {rise:mix(from.rise,to.rise,p),scale:mix(from.scale,to.scale,p),opacity:mix(from.opacity,to.opacity,p),blur:mix(from.blur,to.blur,p)};
}

// Drift is in em, begins once the entry has settled and saturates at six
// seconds. Seeking or rendering a range cannot accumulate it.
export function whisperDrift(offset,entryEnd){
  if(offset<=entryEnd)return 0;
  return -.16*whisperEase((offset-entryEnd)/6);
}

const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const whisperGraphemes=text=>Array.from(segmenter.segment(text),item=>item.segment);
