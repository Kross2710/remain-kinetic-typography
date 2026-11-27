import {useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent,type PointerEvent,type RefObject} from 'react';
import {contentWidth,timeToX,xToTime,type View} from '../editor.mjs';
import {FPS,type Cue} from '../project.mjs';
import {moveCue,snapTime,trimCue,rulerTicks,visibleCues} from '../timeline.mjs';

type MediaClip={name:string;seconds:number};
const TOUCH_SLOP=8;
type Props={
  viewport:RefObject<HTMLDivElement|null>; viewportWidth:number; view:View;
  length:number; frame:number; cues:Cue[]; allCues:Cue[]; liveLine:number; selectedLine:number|null; snapEnabled:boolean;
  video:MediaClip|null; audio:MediaClip|null;
  onScroll:(x:number)=>void; onSeek:(frame:number)=>void; onPickCue:(index:number)=>void; onCommit:(cues:Cue[])=>void;
};

export function TimelineTracks({viewport,viewportWidth,view,length,frame,cues,allCues,liveLine,selectedLine,snapEnabled,video,audio,onScroll,onSeek,onPickCue,onCommit}:Props) {
  const duration=length/FPS;
  const [preview,setPreview]=useState<Cue[]|null>(null);
  const displayed=preview?.filter(c=>c.start<duration) ?? cues;
  const cueGesture=useRef<{index:number;x:number;original:Cue[];latest:Cue[];moved:boolean;trim:boolean}|null>(null);
  const suppressClick=useRef(false);
  const [focusedCue,setFocusedCue]=useState<number>();
  const pendingCueFocus=useRef<number|undefined>(undefined);
  const gesture=useRef<{x:number;y:number;scrubbing:boolean}|null>(null);
  const ticks=useMemo(()=>rulerTicks(view,viewportWidth,duration),[view,viewportWidth,duration]);
  const blocks=useMemo(()=>visibleCues(displayed,view,viewportWidth,duration,focusedCue),[displayed,view,viewportWidth,duration,focusedCue]);
  const beginCue=(e:PointerEvent<HTMLButtonElement>,index:number)=>{
    if (!e.isPrimary || e.button!==0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cueGesture.current={index,x:e.clientX,original:allCues,latest:allCues,moved:false,trim:!!(e.target as Element).closest('.cue-trim-handle')};
  };
  const moveCuePointer=(e:PointerEvent<HTMLButtonElement>)=>{
    const active=cueGesture.current;
    if (!active || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientX-active.x)<4 && !active.moved) return;
    active.moved=true;
    const raw=(active.trim?active.original[active.index+1].start:active.original[active.index].start)+(e.clientX-active.x)/view.pxPerSec;
    const start=snapTime(raw,{enabled:snapEnabled,starts:active.original.map((c,i)=>i===active.index || active.trim && i===active.index+1?Infinity:c.start),pxPerSec:view.pxPerSec});
    try {active.latest=active.trim?trimCue(active.original,active.index,start,duration):moveCue(active.original,active.index,start,duration);setPreview(active.latest);} catch {/* Keep the last valid position. */}
  };
  const endCue=(e:PointerEvent<HTMLButtonElement>)=>{
    const active=cueGesture.current;
    if (!active || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (active.latest!==active.original) onCommit(active.latest);
    cueGesture.current=null;
    suppressClick.current=active.moved;
    setPreview(null);
  };
  const focusCue=(target:number)=>{
    const el=viewport.current;
    if (!el || !cues[target]) return;
    const x=timeToX(cues[target].start,view);
    if (x<el.scrollLeft || x>=el.scrollLeft+el.clientWidth-28) {
      el.scrollLeft=x-el.clientWidth/3;
      onScroll(el.scrollLeft);
    }
    pendingCueFocus.current=target;
    setFocusedCue(target);
  };
  const moveCueFocus=(e:KeyboardEvent<HTMLElement>,index?:number)=>{
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target=e.key==='Home'?0:e.key==='End'?cues.length-1:
      index!==undefined && e.key==='ArrowRight'?index+1:
      index!==undefined && e.key==='ArrowLeft'?index-1:null;
    if (target===null || !cues.length) return;
    e.preventDefault();
    if (target!==index) focusCue(target);
  };
  const editCueKey=(e:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key==='ArrowLeft' || e.key==='ArrowRight')) {
      e.preventDefault();
      const trim=e.altKey;
      if (trim && !cues[index+1]) return;
      const target=(trim?allCues[index+1]:allCues[index]).start+(e.key==='ArrowRight'?1:-1)/FPS;
      try {onCommit(trim?trimCue(allCues,index,target,duration):moveCue(allCues,index,target,duration));} catch {/* At the timeline boundary: no change. */}
      return;
    }
    moveCueFocus(e,index);
  };
  useLayoutEffect(()=>{
    const index=pendingCueFocus.current;
    if (index===undefined || index!==focusedCue) return;
    pendingCueFocus.current=undefined;
    viewport.current?.querySelector<HTMLButtonElement>(`button[data-cue-index="${index}"]`)?.focus({preventScroll:true});
  },[focusedCue,viewport]);
  const seekAt=(clientX:number)=>{
    const el=viewport.current;
    if (!el) return;
    const x=Math.min(el.clientWidth,Math.max(0,clientX-el.getBoundingClientRect().left));
    onSeek(xToTime(el.scrollLeft+x,view)*FPS);
  };
  const startScrub=(e:PointerEvent<HTMLDivElement>)=>{
    if (!e.isPrimary || e.button!==0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current={x:e.clientX,y:e.clientY,scrubbing:e.pointerType==='mouse'};
    if (gesture.current.scrubbing) seekAt(e.clientX);
  };
  const moveScrub=(e:PointerEvent<HTMLDivElement>)=>{
    const active=gesture.current;
    if (!active || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx=Math.abs(e.clientX-active.x);
    const dy=Math.abs(e.clientY-active.y);
    if (dx>=TOUCH_SLOP && dx>dy) active.scrubbing=true;
    if (active.scrubbing) seekAt(e.clientX);
  };
  const endScrub=(e:PointerEvent<HTMLDivElement>)=>{
    const active=gesture.current;
    if (!active || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const tap=Math.hypot(e.clientX-active.x,e.clientY-active.y)<TOUCH_SLOP;
    if (active.scrubbing || tap) seekAt(e.clientX);
  };
  const mediaTrack=(clip:MediaClip|null,empty:string,kind:string)=><div className={`track ${kind}-track`}>
    {clip?<span className="timeline-media-clip" title={clip.name} style={{width:timeToX(clip.seconds,view)}}>{clip.name}</span>:<span className="timeline-empty">{empty}</span>}
  </div>;

  return <div className="timeline-grid">
    <div className="timeline-labels" aria-hidden="true"><span>Thời gian</span><span>Video</span><span>Nhạc</span><span>Lời</span></div>
    <input id="timeline" aria-label="Vị trí timeline" aria-valuetext={`${(frame/FPS).toFixed(2)} giây`} type="range" min={0} max={length-1} step={1} value={frame} onChange={e=>onSeek(Number(e.target.value))}/>
    <div className="timeline-viewport" ref={viewport} role="region" aria-label="Thước thời gian và các làn"
      aria-description="Dùng Home hoặc End để tới đoạn lời đầu hoặc cuối. Trên dòng lời, trái/phải chuyển dòng, Enter tua, Shift+trái/phải dời dòng một khung, Alt+Shift+trái/phải sửa ranh giới phải." tabIndex={0}
      onKeyDown={e=>{if (e.target===e.currentTarget) moveCueFocus(e);}}
      onScroll={e=>{if (e.target===e.currentTarget) onScroll(e.currentTarget.scrollLeft);}}>
      <div className="track-strip" style={{width:contentWidth(duration,view)}}>
        <div className="timeline-ruler" aria-hidden="true" onPointerDown={startScrub}
          onPointerMove={moveScrub} onPointerUp={endScrub} onLostPointerCapture={()=>{gesture.current=null;}}>
          {ticks.map(({x,label})=><span key={x} className={`timeline-tick${label?' major':''}`} style={{left:x}}>{label}</span>)}
        </div>
        <div className="timeline-lanes" onClick={e=>{if (!(e.target as Element).closest('button')) seekAt(e.clientX);}}>
          {mediaTrack(video,'Chưa có video','video')}
          {mediaTrack(audio,'Chưa có nhạc','audio')}
          <div className="track lyric-track">
            {blocks.map(({index:i,x,width})=>{
              const cue=displayed[i];
              const complete=cue.words.every(w=>w.confirmed);
              const selected=selectedLine===i;
              const stamp=`${cue.start.toFixed(2)}s`;
              const status=complete?' · Đã canh xong':'';
              return <button type="button" key={i} className={i===liveLine?'live':''} data-complete={complete || undefined} data-selected={selected || undefined}
                aria-current={i===liveLine?'time':undefined} title={`${cue.text} · ${stamp}${status}`}
                aria-label={`Tua đến dòng ${i+1}: ${cue.text}${status}${selected?' · Đang chọn':''}`} onClick={()=>{if(suppressClick.current){suppressClick.current=false;return;}onPickCue(i);}}
                onPointerDown={e=>beginCue(e,i)} onPointerMove={moveCuePointer} onPointerUp={endCue}
                onLostPointerCapture={()=>{
                  const g=cueGesture.current;
                  if (g && g.latest!==g.original) onCommit(g.latest);
                  cueGesture.current=null;setPreview(null);
                }}
                data-cue-index={i} onKeyDown={e=>editCueKey(e,i)}
                onFocus={()=>setFocusedCue(i)} onBlur={()=>setFocusedCue(undefined)} style={{left:x,width}}>
                {complete && <span className="cue-check" aria-hidden="true">✓ </span>}{cue.text}
                {displayed[i+1] && <span className="cue-trim-handle" aria-hidden="true" title="Kéo để sửa ranh giới với dòng tiếp" style={{pointerEvents:'auto',position:'absolute',right:0,top:0,bottom:0,width:'12px',zIndex:2}}/>}
              </button>;
            })}
          </div>
        </div>
        <div className="timeline-playhead" aria-hidden="true" style={{left:timeToX(frame/FPS,view)}}/>
      </div>
    </div>
  </div>;
}
