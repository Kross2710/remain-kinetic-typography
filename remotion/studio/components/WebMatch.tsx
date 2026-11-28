import {useCallback,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AbsoluteFill,Html5Audio,OffthreadVideo,Sequence,useCurrentFrame,useDelayRender,useRemotionEnvironment,useVideoConfig} from 'remotion';
import {bootWebMatch,webMatchDocument} from '../web-match';
import type {SceneProps} from '../Scene';

export function WebMatch({project,audioSrc,videoSrc,trackVisible,hasTrackMedia,trackLayer}:SceneProps & {
  trackVisible:boolean;hasTrackMedia:boolean;trackLayer:ReactNode;
}){
  const frame=useCurrentFrame();
  const {width,height,fps}=useVideoConfig();
  const visible=trackVisible||(Boolean(videoSrc)&&frame<(project.videoDurationInFrames ?? project.durationInFrames));
  const videoVisible=Boolean(videoSrc)||hasTrackMedia;
  const config=useMemo(()=>({width,height,durationInFrames:project.durationInFrames,cues:project.cues,sections:project.sections,showSections:project.showSections}),[width,height,project.durationInFrames,project.cues,project.sections,project.showSections]);
  const viewport=useRef<HTMLIFrameElement>(null);
  const driver=useRef<Awaited<ReturnType<typeof bootWebMatch>>|null>(null);
  const generation=useRef(0);
  const requested=useRef({frame,visible});
  const [media,setMedia]=useState<HTMLElement|null>(null);
  const {delayRender,continueRender,cancelRender}=useDelayRender();
  const {isRendering}=useRemotionEnvironment();
  const [failure,setFailure]=useState('');
  const handle=useRef<number|null>(null);
  const release=useCallback(()=>{
    if(handle.current!==null){continueRender(handle.current);handle.current=null;}
  },[continueRender]);
  const reportFailure=useCallback((error:unknown)=>{
    setFailure(error instanceof Error?error.message:String(error));
    if(isRendering)cancelRender(error);
    release();
  },[isRendering,cancelRender,release]);
  const reset=useCallback(()=>{
    const revision=++generation.current;
    driver.current=null;
    setMedia(null);
    setFailure('');
    if(handle.current===null)handle.current=delayRender('Load Web Match document and fonts');
    void webMatchDocument().then(html=>{
      if(revision===generation.current && viewport.current)viewport.current.srcdoc=html;
    }).catch(error=>{if(revision===generation.current)reportFailure(error);});
  },[delayRender,reportFailure]);
  useLayoutEffect(()=>{
    reset();
    return ()=>{generation.current++;driver.current=null;release();};
  },[config,fps,videoVisible,reset,release]);
  useLayoutEffect(()=>{
    requested.current={frame,visible};
    const current=driver.current;
    if(current && frame<current.frame)reset();
    else current?.seek(frame,visible);
  },[frame,visible,reset]);

  async function onLoad(){
    const win=viewport.current?.contentWindow;
    if(!win?.document.getElementById('web-match-media'))return;
    const revision=generation.current;
    try{
      const next=await bootWebMatch(win,config,fps,videoVisible);
      if(revision!==generation.current)return;
      next.seek(requested.current.frame,requested.current.visible);
      driver.current=next;
      setMedia(win.document.getElementById('web-match-media'));
    }catch(error){
      if(revision!==generation.current)return;
      reportFailure(error);
    }
  }
  // Match the desktop viewport in landscape and the site's mobile media query
  // in portrait, independent of the editor's on-screen player size.
  const scale=width<height?2:1;
  useLayoutEffect(()=>{if(media)release();},[media,release]);
  return <AbsoluteFill style={{background:'#0b0e16',overflow:'hidden'}}>
    <iframe ref={viewport} title="Web Match · preview" data-web-match onLoad={()=>void onLoad()} tabIndex={-1}
      style={{border:0,width:width/scale,height:height/scale,position:'absolute',inset:0,pointerEvents:'none',transformOrigin:'top left',transform:`scale(${scale})`}} />
    {media && videoSrc && createPortal(<Sequence layout="none" durationInFrames={project.videoDurationInFrames ?? project.durationInFrames}>
      <OffthreadVideo className="bgvideo" src={videoSrc} muted={Boolean(audioSrc)} pauseWhenBuffering />
    </Sequence>,media)}
    {media && hasTrackMedia && createPortal(trackLayer,media)}
    {audioSrc && <Html5Audio src={audioSrc}/>}
    {failure && <div role="alert" style={{color:'white',padding:16}}>{failure}</div>}
  </AbsoluteFill>;
}
