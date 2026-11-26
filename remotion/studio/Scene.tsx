import {AbsoluteFill, Html5Audio, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {activeAt, type Project} from './project.mjs';

export type SceneProps = {project:Project; audioSrc:string|null; videoSrc:string|null};

export function Scene({project,audioSrc,videoSrc}:SceneProps) {
  const frame = useCurrentFrame();
  const {fps,width,height} = useVideoConfig();
  const t = frame / fps;
  const [line, word] = activeAt(project.cues,t);
  const cue = project.cues[line];
  const offset = cue ? t - cue.start : 0;
  const rise = interpolate(offset,[0,.28],[.9,0],{extrapolateRight:'clamp'});
  const glow = 25+Math.sin(t*.45)*12;
  const size = Math.min(width,height) * (cue && cue.text.length > 60 ? .084 : .105);
  return <AbsoluteFill style={{background:`radial-gradient(ellipse at ${glow}% 15%, #493044 0%, transparent 53%), radial-gradient(ellipse at 92% 92%, #3a211f 0%, transparent 61%), #140f12`, fontFamily:'Georgia, Palatino, serif',color:'#ece3d4',display:'grid',placeItems:'center',overflow:'hidden'}}>
    {videoSrc && <Sequence durationInFrames={project.videoDurationInFrames ?? project.durationInFrames}>
      <OffthreadVideo src={videoSrc} muted={Boolean(audioSrc)} pauseWhenBuffering style={{width:'100%',height:'100%',objectFit:'cover'}}/>
      {cue && <AbsoluteFill style={{pointerEvents:'none',background:'linear-gradient(transparent, #100a1066, transparent)'}}/>}
    </Sequence>}
    {cue && <div style={{position:'relative',zIndex:1,width:'88%',textAlign:'center',fontSize:size,lineHeight:1.12,letterSpacing:'-.045em',overflowWrap:'anywhere',textShadow:videoSrc?'0 2px 10px #000b':undefined}} aria-label={cue.text}>
      {cue.words.map((w,i) => <span key={i} style={{display:'inline-block',overflow:'hidden',verticalAlign:'bottom',maxWidth:'100%',padding:'0 .115em'}}><span data-word-active={i===word} style={{display:'inline-block',transform:`translateY(${rise * 85}%)`,opacity:i===word?1:.56,color:i===word?'#f0b15c':'#ece3d4'}}>{w.text}</span></span>)}
    </div>}
    {audioSrc && <Html5Audio src={audioSrc}/>}
  </AbsoluteFill>;
}
