import {useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import type {Cue} from '../project.mjs';
import {webFlowOffset,webFlowPast} from '../shared-motion.mjs';
import {firstWhisperFrame as firstFrame} from '../whisper.mjs';

const HISTORY=8;

export function SharedLyricFlow({cues,line,frame,fps,height,draw}:{cues:Cue[];line:number;frame:number;fps:number;height:number;draw:(index:number,time:number,past:boolean)=>ReactNode}){
  const start=Math.max(0,line-HISTORY);
  const rows=useMemo(()=>cues.slice(start,line+1).flatMap((cue,i)=>{
    const index=start+i;
    const began=firstFrame(cue.start,fps);
    const next=cues[index+1];
    if(next && firstFrame(next.start,fps)===began)return [];
    return [{index,began:began/fps,lastTime:next?(firstFrame(next.start,fps)-1)/fps:began/fps}];
  }),[cues,start,line,fps]);
  const flow=useRef<HTMLDivElement>(null);
  const [geometry,setGeometry]=useState<{rows:typeof rows;centers:number[]} | null>(null);
  useLayoutEffect(()=>{
    const node=flow.current;
    if(!node)return;
    const measure=()=>{
      const centers=Array.from(node.children,child=>{
        const row=child as HTMLElement;
        return row.offsetTop+row.offsetHeight/2;
      });
      setGeometry(old=>old?.rows===rows && old.centers.every((v,i)=>v===centers[i]) ? old : {rows,centers});
    };
    measure();
    const observer=new ResizeObserver(measure);
    for(const child of Array.from(node.children))observer.observe(child);
    return ()=>observer.disconnect();
  },[rows]);
  const time=frame/fps;
  const ready=geometry?.rows===rows;
  const starts=rows.map(r=>r.began);
  const offset=ready?webFlowOffset(starts,geometry.centers,time):0;
  return <AbsoluteFill data-shared-flow style={{pointerEvents:'none',overflow:'hidden',maskImage:'linear-gradient(180deg,transparent 0%,#000 15%,#000 82%,transparent 100%)'}}>
    <div ref={flow} data-flow-offset={offset} style={{position:'absolute',inset:'0 0 auto',display:'grid',gap:7,visibility:ready?'visible':'hidden',transform:`translateY(${height*.58+offset}px)`}}>
      {rows.map(({index,lastTime},pos)=>{
        const past=index!==line;
        const pose=past?webFlowPast(starts.slice(pos+1),time):undefined;
        return <div key={cues[index].start} data-flow-past={past||undefined} aria-hidden={past||undefined}
          style={{display:'grid',placeItems:'center',opacity:pose?.opacity,filter:pose?.blur?`blur(${pose.blur}px)`:undefined,
            transform:pose?`translateY(${pose.lift}px) scale(${pose.zoom})`:undefined}}>
          {draw(index,past?lastTime:time,past)}
        </div>;
      })}
    </div>
  </AbsoluteFill>;
}
