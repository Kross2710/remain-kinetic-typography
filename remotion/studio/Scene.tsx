import {AbsoluteFill,Html5Audio,OffthreadVideo,Sequence,interpolate,interpolateColors,useCurrentFrame,useVideoConfig} from 'remotion';
import {activeAt,type Cue,type Project} from './project.mjs';
import {FONT_STACKS,PRESETS} from './effects.mjs';
import {SongChrome} from './components/SongChrome';

export type SceneProps = {project:Project; audioSrc:string|null; videoSrc:string|null};
const smooth=(x:number)=>{const p=Math.max(0,Math.min(1,x));return p*p*(3-2*p);};

function LyricLine({cue,project,time,sizeBase,hasVideo,exit}: {cue:Cue;project:Project;time:number;sizeBase:number;hasVideo:boolean;exit?:number}) {
  const effect=cue.effect ?? project.effect ?? PRESETS.classic;
  const aurora=effect.preset==='aurora';
  const offset=time-cue.start;
  const size=sizeBase*(cue.text.length>60 ? .8 : 1)*effect.size;
  const incoming=aurora?smooth(offset/effect.entry):1;
  const word=activeAt([cue],time)[1];
  const motion=exit ?? 0;
  return <div data-lyric-preset={exit===undefined?effect.preset:undefined} data-outgoing-lyric={exit!==undefined?true:undefined} aria-label={exit===undefined?cue.text:undefined} aria-hidden={exit!==undefined?true:undefined}
    style={{gridArea:'1 / 1',position:'relative',zIndex:exit!==undefined?0:1,width:'88%',textAlign:'center',fontSize:size,fontFamily:FONT_STACKS[effect.font],lineHeight:1.12,letterSpacing:'-.045em',overflowWrap:'anywhere',textShadow:hasVideo?'0 2px 10px #000b':undefined,opacity:1-motion,filter:motion?`blur(${motion*4}px)`:undefined,transform:aurora||motion?`translateY(${((1-incoming)*.14-motion*.9)*size}px) scale(${1-motion*.09})`:undefined}}>
    {cue.words.map((w,i)=>{
      const p=interpolate(offset-i*effect.stagger,[0,effect.entry],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
      const easing=aurora?smooth(p):p;
      const emphasized=w.emphasis===true;
      const highlighted=i===word || (emphasized && time>=w.start);
      const next=cue.words[i+1];
      let light=highlighted?1:0;
      if(aurora && time>=w.start){
        const attack=smooth((time-w.start)/.14);
        const release=next && time>=next.start && !emphasized ? 1-smooth((time-next.start)/.16) : 1;
        light=attack*release;
      }
      return <span key={i} style={{display:'inline-block',overflow:'hidden',verticalAlign:'bottom',maxWidth:'100%',padding:'0 .115em'}}>
        <span data-word-active={exit===undefined && i===word} data-word-emphasis={emphasized || undefined}
          style={{display:'inline-block',transform:`translateY(${(1-easing)*(aurora?56:76.5)}%)`,opacity:(.56+.44*light)*(aurora?easing:1),filter:aurora && easing<1?`blur(${(1-easing)*4}px)`:undefined,color:aurora?interpolateColors(light,[0,1],[effect.color,effect.accent]):highlighted?effect.accent:effect.color,fontWeight:emphasized && (aurora || highlighted)?700:undefined}}>{w.text}</span>
      </span>;
    })}
  </div>;
}

export function Scene({project,audioSrc,videoSrc}:SceneProps) {
  const frame=useCurrentFrame();
  const {fps,width,height}=useVideoConfig();
  const t=frame/fps;
  const [line]=activeAt(project.cues,t);
  const cue=project.cues[line];
  const effect=cue?.effect ?? project.effect ?? PRESETS.classic;
  const scale=Math.min(width,height);
  const sizeBase=scale*.105;
  const duration=project.durationInFrames/fps;
  const glow=25+Math.sin(t*.45)*12;
  const outgoing: {cue:Cue;lastTime:number;motion:number}[]=[];
  if(cue && effect.preset==='aurora'){
    // Continue the previous line's last rendered pose, not a new plain text line.
    for(let i=line-1;i>=0;i--){
      const nextStart=project.cues[i+1].start;
      const age=t-nextStart;
      if(age>=.9)break;
      const past=project.cues[i];
      outgoing.unshift({cue:past,lastTime:Math.max(past.start,(Math.ceil(nextStart*fps)-1)/fps),motion:smooth(age/.9)});
    }
  }
  return <AbsoluteFill style={{background:`radial-gradient(ellipse at ${glow}% 15%, #493044 0%, transparent 53%), radial-gradient(ellipse at 92% 92%, #3a211f 0%, transparent 61%), #140f12`,fontFamily:FONT_STACKS.serif,color:'#ece3d4',display:'grid',placeItems:'center',overflow:'hidden'}}>
    {videoSrc && <Sequence durationInFrames={project.videoDurationInFrames ?? project.durationInFrames}>
      <OffthreadVideo src={videoSrc} muted={Boolean(audioSrc)} pauseWhenBuffering style={{width:'100%',height:'100%',objectFit:'cover'}}/>
      {cue && <AbsoluteFill style={{pointerEvents:'none',background:'linear-gradient(transparent, #100a1066, transparent)'}}/>}
    </Sequence>}
    {project.showSections && <SongChrome sections={project.sections ?? []} time={t} duration={duration} scale={scale}/>}
    <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',pointerEvents:'none'}}>
      {outgoing.map(({cue:past,lastTime,motion})=><LyricLine key={past.start} cue={past} project={project} time={lastTime} sizeBase={sizeBase} hasVideo={Boolean(videoSrc)} exit={motion}/>)}
      {cue && <LyricLine key={cue.start} cue={cue} project={project} time={t} sizeBase={sizeBase} hasVideo={Boolean(videoSrc)}/>}
    </div>
    {audioSrc && <Html5Audio src={audioSrc}/>}
  </AbsoluteFill>;
}
