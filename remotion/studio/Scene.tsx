import {AbsoluteFill,Html5Audio,OffthreadVideo,Sequence,interpolate,interpolateColors,useCurrentFrame,useVideoConfig} from 'remotion';
import {activeAt,type Cue,type Project} from './project.mjs';
import {FONT_STACKS,PRESETS,resolveMotion} from './effects.mjs';
import {SongChrome} from './components/SongChrome';
import {WhisperAtmosphere,WhisperLine,WhisperPast} from './components/Whisper';
import {WebMatch} from './components/WebMatch';
import {composeWebText} from './components/SharedTextMotion';
import {SharedLyricFlow} from './components/SharedLyricFlow';
import {firstWhisperFrame,whisperStack} from './whisper.mjs';

export type SceneProps = {project:Project; audioSrc:string|null; videoSrc:string|null};
const smooth=(x:number)=>{const p=Math.max(0,Math.min(1,x));return p*p*(3-2*p);};

function LyricLine({cue,project,time,sizeBase,hasVideo,exit,shared}: {cue:Cue;project:Project;time:number;sizeBase:number;hasVideo:boolean;exit?:number;shared?:ReturnType<typeof composeWebText>}) {
  const effect=cue.effect ?? project.effect ?? PRESETS.classic;
  const aurora=effect.preset==='aurora';
  const offset=time-cue.start;
  const size=sizeBase*(cue.text.length>60 ? .8 : 1)*effect.size;
  const incoming=aurora?smooth(offset/effect.entry):1;
  const word=activeAt([cue],time)[1];
  const motion=exit ?? 0;
  const entry=shared?.entry;
  const replacesEntry=Boolean(entry || shared?.ink);
  const blur=(entry?.blur ?? 0)+motion*4;
  return <div data-shared-entry={entry?true:undefined} data-lyric-preset={exit===undefined?effect.preset:undefined} data-outgoing-lyric={exit!==undefined?true:undefined} aria-label={exit===undefined?cue.text:undefined} aria-hidden={exit!==undefined?true:undefined}
    style={{gridArea:'1 / 1',position:'relative',zIndex:exit!==undefined?0:1,width:'88%',textAlign:'center',fontSize:size,fontFamily:FONT_STACKS[effect.font],lineHeight:1.12,letterSpacing:'-.045em',overflowWrap:'anywhere',textShadow:hasVideo?'0 2px 10px #000b':undefined,opacity:(1-motion)*(entry?.opacity ?? 1),filter:blur?`blur(${blur}px)`:undefined,transform:replacesEntry?`translateY(${(entry?.lift ?? 0)-motion*.9*size}px) scale(${(entry?.zoom ?? 1)*(1-motion*.09)})`:aurora||motion?`translateY(${((1-incoming)*.14-motion*.9)*size}px) scale(${1-motion*.09})`:undefined}}>
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
      return <span key={i} style={{display:'inline-block',overflow:shared?.ink?'visible':'hidden',verticalAlign:'bottom',maxWidth:'100%',padding:'0 .115em'}}>
        <span data-word-active={exit===undefined && i===word} data-word-emphasis={emphasized || undefined}
          style={{display:'inline-block',transform:replacesEntry?(shared?.entry?`translateY(${shared.rise(i)}%)`:undefined):`translateY(${(1-easing)*(aurora?56:76.5)}%)`,opacity:(shared?.wipe?1:(.56+.44*light))*(aurora&&!replacesEntry?easing:1),filter:aurora && easing<1&&!replacesEntry?`blur(${(1-easing)*4}px)`:undefined,color:aurora?interpolateColors(light,[0,1],[effect.color,effect.accent]):highlighted?effect.accent:effect.color,fontWeight:emphasized && (aurora || highlighted)?700:undefined}}>{shared?.glyphs(i) ?? w.text}</span>
      </span>;
    })}
  </div>;
}

export function Scene({project,audioSrc,videoSrc}:SceneProps) {
  const frame=useCurrentFrame();
  const {fps,width,height}=useVideoConfig();
  const t=frame/fps;
  if(project.effect?.preset==='web-match')return <WebMatch project={project} audioSrc={audioSrc} videoSrc={videoSrc}/>;
  const [line]=activeAt(project.cues,t);
  const cue=project.cues[line];
  const effect=cue?.effect ?? project.effect ?? PRESETS.classic;
  const projectWhisper=project.effect?.preset==='whisper';
  const whisper=projectWhisper;
  const scale=Math.min(width,height);
  const flow=project.effect?.motion?.flow===true;
  const stack=!flow&&whisper&&cue?whisperStack(project.cues,line,frame,fps):[];
  const sizeBase=scale*.105;
  const duration=project.durationInFrames/fps;
  const glow=25+Math.sin(t*.45)*12;
  const hasVideo=Boolean(videoSrc);
  function draw(index:number,time:number,exit?:number){
    const target=project.cues[index];
    const style=target.effect ?? project.effect ?? PRESETS.classic;
    const settings=resolveMotion(project.effect,target.motion);
    const shared=settings.enter||settings.wipe||settings.ink
      ? composeWebText(target,style,time,project.cues[index+1]?.start ?? duration,settings):undefined;
    return style.preset==='whisper'
      ? <WhisperLine key={target.start} cue={target} effect={style} time={time} scale={scale} hasVideo={hasVideo} past={exit!==undefined} shared={shared}/>
      : <LyricLine key={target.start} cue={target} project={project} time={time} sizeBase={sizeBase} hasVideo={hasVideo} exit={exit} shared={shared}/>;
  }
  const outgoing: {index:number;lastTime:number;motion:number}[]=[];
  if(!flow && cue && effect.preset==='aurora'){
    // Continue the previous line's last rendered pose, not a new plain text line.
    const whisperHandoff=project.effect?.preset==='whisper' || project.cues.slice(Math.max(0,line-2),line).some(past=>past.effect?.preset==='whisper');
    for(let i=line-1;i>=0;i--){
      const nextStart=project.cues[i+1].start;
      const age=t-nextStart;
      if(age>=.9)break;
      const past=project.cues[i];
      const wasWhisper=(past.effect ?? project.effect)?.preset==='whisper';
      if(i<line-2 && (whisperHandoff || wasWhisper))continue;
      const lastFrame=wasWhisper?firstWhisperFrame(nextStart,fps)-1:Math.ceil(nextStart*fps)-1;
      if(wasWhisper && lastFrame<firstWhisperFrame(past.start,fps))continue;
      outgoing.unshift({index:i,lastTime:Math.max(past.start,lastFrame/fps),motion:smooth(age/.9)});
    }
  }
  return <AbsoluteFill style={{background:`radial-gradient(ellipse at ${glow}% 15%, #493044 0%, transparent 53%), radial-gradient(ellipse at 92% 92%, #3a211f 0%, transparent 61%), #140f12`,fontFamily:FONT_STACKS.serif,color:'#ece3d4',display:'grid',placeItems:'center',overflow:'hidden'}}>
    {videoSrc && <Sequence durationInFrames={project.videoDurationInFrames ?? project.durationInFrames}>
      <OffthreadVideo src={videoSrc} muted={Boolean(audioSrc)} pauseWhenBuffering style={{width:'100%',height:'100%',objectFit:'cover'}}/>
      {cue && <AbsoluteFill style={{pointerEvents:'none',background:'linear-gradient(transparent, #100a1066, transparent)'}}/>}
    </Sequence>}
    {whisper && <WhisperAtmosphere frame={frame} time={t}/>}
    {project.showSections && <SongChrome sections={project.sections ?? []} time={t} duration={duration} scale={scale}/>}
    {flow && cue ? <SharedLyricFlow cues={project.cues} line={line} frame={frame} fps={fps} height={height} draw={(index,time,past)=>draw(index,time,past?0:undefined)}/> :
    <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',pointerEvents:'none'}}>
      {outgoing.map(({index,lastTime,motion})=>{
        const past=project.cues[index];
        const pastEffect=past.effect ?? project.effect ?? PRESETS.classic;
        return pastEffect.preset==='whisper'
          ? <WhisperPast key={past.start} scale={scale} pose={{rise:motion*.09,scale:1-motion*.09,opacity:1-motion,blur:motion*4}}>{draw(index,lastTime,0)}</WhisperPast>
          : draw(index,lastTime,motion);
      })}
      {stack.map(({index,time,pose})=><WhisperPast key={project.cues[index].start} pose={pose} scale={scale}>{draw(index,time,0)}</WhisperPast>)}
      {cue && draw(line,t)}
    </div>}
    {audioSrc && <Html5Audio src={audioSrc}/>}
  </AbsoluteFill>;
}
