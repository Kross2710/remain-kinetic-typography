import type {ReactNode} from 'react';
import {AbsoluteFill,interpolateColors} from 'remotion';
import {FONT_STACKS,type Effect} from '../effects.mjs';
import {activeAt,type Cue} from '../project.mjs';
import type {composeWebText} from './SharedTextMotion';
import {whisperDrift,whisperEase,whisperGraphemes,type WhisperPose} from '../whisper.mjs';

const grain=[
  new URL('../assets/whisper-grain-1.png',import.meta.url).href,
  new URL('../assets/whisper-grain-2.png',import.meta.url).href,
  new URL('../assets/whisper-grain-3.png',import.meta.url).href,
];

export function WhisperAtmosphere({frame,time}: {frame:number;time:number}) {
  return <AbsoluteFill aria-hidden="true" data-whisper-atmosphere style={{pointerEvents:'none',isolation:'isolate',overflow:'hidden'}}>
    <AbsoluteFill style={{inset:'-16%',width:'auto',height:'auto',transform:`translate(${Math.sin(time*.19)*7}%, ${Math.sin(time*.14)*4}%)`,background:'radial-gradient(ellipse at 45% 38%, #70425f48, transparent 58%)'}}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at center, transparent 38%, #08060ab0 100%)'}}/>
    <AbsoluteFill style={{backgroundImage:`url("${grain[frame%grain.length]}")`,opacity:.075,mixBlendMode:'soft-light'}}/>
  </AbsoluteFill>;
}

export function WhisperPast({pose,scale,children}: {pose:WhisperPose;scale:number;children:ReactNode}) {
  return <AbsoluteFill aria-hidden="true" data-whisper-past style={{display:'grid',placeItems:'center',opacity:pose.opacity,filter:pose.blur?`blur(${pose.blur}px)`:undefined,transform:`translateY(${-pose.rise*scale}px) scale(${pose.scale})`}}>
    {children}
  </AbsoluteFill>;
}

export function WhisperLine({cue,effect,time,scale,hasVideo,past=false,shared}: {cue:Cue;effect:Effect;time:number;scale:number;hasVideo:boolean;past?:boolean;shared?:ReturnType<typeof composeWebText>}) {
  const elapsed=time-cue.start;
  const size=scale*.085*(cue.text.length>60?.82:1)*effect.size;
  const replacesEntry=Boolean(shared?.entry || shared?.ink);
  const glyphs=cue.hook&&!shared?.ink ? cue.words.map(word=>whisperGraphemes(word.text)) : null;
  const count=glyphs?.reduce((total,word)=>total+word.length,0) ?? 0;
  const gap=count>1?Math.min(.042,.48/(count-1)):0;
  const stagger=cue.words.length>1?Math.min(effect.stagger,.4/(cue.words.length-1)):0;
  const entryEnd=shared?.entryEnd ?? (effect.entry+(glyphs?(count-1)*gap:(cue.words.length-1)*stagger));
  const lift=(replacesEntry?0:(1-whisperEase(elapsed/effect.entry))*.11)+whisperDrift(elapsed,entryEnd);
  const [,current]=activeAt([cue],time);
  let index=0;
  return <div data-shared-entry={shared?.entry?true:undefined} data-lyric-preset={past?undefined:'whisper'} data-outgoing-lyric={past||undefined} aria-label={past?undefined:cue.text}
    style={{gridArea:'1 / 1',position:'relative',zIndex:past?undefined:1,width:'88%',textAlign:'center',fontSize:size,fontFamily:FONT_STACKS[effect.font],lineHeight:1.16,letterSpacing:'-.025em',overflowWrap:'anywhere',textShadow:hasVideo?'0 2px 12px #08060cdb':'0 1px 8px #140b14b3',opacity:shared?.entry?.opacity,filter:shared?.entry?.blur?`blur(${shared.entry.blur}px)`:undefined,transform:shared?.entry?`translateY(calc(${lift}em + ${shared.entry.lift}px)) scale(${shared.entry.zoom})`:`translateY(${lift}em)`}}>
    {cue.words.map((word,i)=>{
      const next=cue.words[i+1];
      const emphasized=word.emphasis===true;
      const attack=whisperEase((time-word.start)/.13);
      const release=emphasized||!next?1:1-whisperEase((time-next.start)/.18);
      const light=attack*release;
      const entry=whisperEase((elapsed-i*stagger)/effect.entry);
      const stock=glyphs?.[i].map(glyph=>({glyph,progress:whisperEase((elapsed-index++*gap)/effect.entry)}));
      return <span key={i} style={{display:'inline-block',maxWidth:'100%',padding:'0 .115em',verticalAlign:'bottom',overflow:shared?.ink || (glyphs && !shared?.entry)?undefined:'hidden'}}>
        <span data-word-active={!past&&i===current} data-word-emphasis={emphasized||undefined}
          style={{display:'inline-block',color:interpolateColors(light,[0,1],[effect.color,effect.accent]),opacity:(shared?.wipe?1:(.62+.38*light))*(glyphs||replacesEntry?1:entry),transform:shared?.entry?`translateY(${shared.rise(i)}%)`:glyphs||shared?.ink?undefined:`translateY(${(1-entry)*55}%)`,fontWeight:emphasized?700:undefined}}>
          {shared?.glyphs(i,stock?.map(g=>g.progress)) ?? stock?.map(({glyph,progress},j)=><span key={j} data-whisper-letter style={{display:'inline-block',opacity:progress,filter:progress<1?`blur(${(1-progress)*3}px)`:undefined}}>{glyph}</span>) ?? word.text}
        </span>
      </span>;
    })}
  </div>;
}
