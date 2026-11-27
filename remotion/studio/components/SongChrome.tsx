import {interpolateColors} from 'remotion';
import {FONT_STACKS, SECTION_LABELS, type SectionKind, type SongSection} from '../effects.mjs';

const palette: Record<SectionKind,string>={intro:'#cbd8e6',verse:'#bfe3da',chorus:'#f2c98a',bridge:'#c8b6e0',outro:'#d2bda7'};
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const smooth=(x:number)=>x*x*(3-2*x);

export function SongChrome({sections,time,duration,scale}: {sections:SongSection[]; time:number; duration:number; scale:number}) {
  let from=sections[0] ? palette[sections[0].kind] : '#f0b15c';
  let to=from;
  let start=0;
  let active=-1;
  // Evaluate each transition's color at the next marker, so overlapping
  // section transitions remain continuous even when markers are close.
  for (const [i,section] of sections.entries()) {
    if(section.start>time)break;
    from=interpolateColors(smooth(clamp((section.start-start)/1.5)),[0,1],[from,to]);
    to=palette[section.kind];
    start=section.start;
    active=i;
  }
  const color=interpolateColors(smooth(clamp((time-start)/1.5)),[0,1],[from,to]);
  const fraction=clamp(time/duration);
  const current=sections[active];
  const previous=sections[active-1];
  // Fit the label transition between markers on tightly spaced sections.
  const labelDuration=current ? Math.min(.42,(sections[active+1]?.start ?? duration)-start) : .42;
  const blend=labelDuration>0?smooth(clamp((time-start)/labelDuration)):1;
  const initial=!previous && start===0;
  const opacity=initial?1:blend;
  const format=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  return <div data-song-section={current?.kind ?? 'pending'} aria-label={current?`Đoạn nhạc: ${SECTION_LABELS[current.kind]}`:undefined} style={{position:'absolute',inset:'0 0 auto',zIndex:2,pointerEvents:'none',fontFamily:FONT_STACKS.sans}}>
    <div style={{height:Math.max(2,scale*.003),background:'#eaedf520'}}>
      <div data-section-progress={fraction} style={{height:'100%',transform:`scaleX(${fraction})`,transformOrigin:'left',backgroundColor:color,maskImage:'linear-gradient(90deg, transparent, #000)'}}/>
    </div>
    <div style={{display:'flex',justifyContent:'space-between',padding:`${scale*.024}px ${scale*.036}px`,fontSize:scale*.022,lineHeight:1.25,letterSpacing:'.2em',textTransform:'uppercase',color:'#eaedf5bf',textShadow:'0 1px 5px #000'}}>
      <div style={{display:'grid'}}>
        {previous && previous.kind!==current?.kind && blend<1 && <span aria-hidden="true" style={{gridArea:'1 / 1',opacity:1-blend,transform:`translateY(${-blend*25}%)`}}>{SECTION_LABELS[previous.kind]}</span>}
        {current && <span style={{gridArea:'1 / 1',opacity:previous?.kind===current.kind?1:opacity,transform:`translateY(${(previous?.kind===current.kind?0:1-opacity)*25}%)`}}>{SECTION_LABELS[current.kind]}</span>}
      </div>
      <span style={{fontVariantNumeric:'tabular-nums'}}>{format(time)} / {format(duration)}</span>
    </div>
  </div>;
}
