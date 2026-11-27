import {interpolateColors} from 'remotion';
import type {MotionId,Effect} from '../effects.mjs';
import type {Cue} from '../project.mjs';
import {inkFrame,karaokeFill,webEntry,wordRise} from '../shared-motion.mjs';
import {whisperGraphemes} from '../whisper.mjs';

// Native Remotion adapters: take the base preset's palette, but not its
// entry clock when one of the imported entry styles is active.
export function composeWebText(cue:Cue,effect:Effect,time:number,end:number,settings:Record<MotionId,boolean>){
  const ink=settings.ink && (cue.hook===true || /\bi will remain\b/i.test(cue.text));
  const elapsed=time-cue.start;
  const entry=settings.enter&&!ink?webEntry(elapsed):null;
  const glyphs=ink||settings.wipe?cue.words.map(w=>whisperGraphemes(w.text)):null;
  const held=ink?cue.words.map(w=>w.text.toLowerCase().replace(/[^a-z']/g,'')==='love'):[];
  const order:number[]=[];
  let count=0;
  if(ink && glyphs)glyphs.forEach((word,i)=>{order[i]=count;if(!held[i])count+=word.length;});
  // The entrance duration is used only to delay Whisper's own hold drift.
  const entryEnd=ink ? .95+Math.max(0,count-1)*.05:entry?Math.max(1.25,1.1+(cue.words.length-1)*.05):undefined;
  return {
    entry, ink, wipe:settings.wipe, entryEnd,
    rise:(i:number)=>entry?wordRise(elapsed,i):0,
    glyphs:(i:number,base?:number[])=>glyphs?.[i].map((glyph,j,word)=>{
      const w=cue.words[i];
      const reveal=ink?inkFrame(held[i]?time-w.start:elapsed,held[i] ? .06 : .05,held[i]?j:order[i]+j,held[i]):null;
      const fill=settings.wipe?karaokeFill(time,w.start,cue.words[i+1]?.start ?? end,word.length,j):null;
      return <span key={j} data-shared-glyph data-motion-wipe={fill??undefined} data-motion-ink={ink||undefined} data-held-glyph={held[i]||undefined} data-whisper-letter={base?true:undefined}
        style={{display:'inline-block',opacity:held[i]&&time<w.start?0:reveal?.opacity ?? base?.[j],
          filter:reveal?.blur?`blur(${reveal.blur}px)`:base&&base[j]<1?`blur(${(1-base[j])*3}px)`:undefined,
          color:fill===null?undefined:interpolateColors(fill,[0,1],[effect.color,effect.accent])}}>{glyph}</span>;
    }),
  };
}
