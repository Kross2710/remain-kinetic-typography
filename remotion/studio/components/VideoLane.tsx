import {useRef,useState,type PointerEvent} from 'react';
import {timeToX,type View} from '../editor.mjs';
import {FPS} from '../project.mjs';
import {clipSpans,type VideoClip} from '../video-track.mjs';
import './video-lane.css';

export type VideoEdits={
  clips: VideoClip[];
  missing: ReadonlySet<string>; // Media IDs, not clip IDs.
  onMove: (id:string,toIndex:number)=>void;
  onTrim: (id:string,inFrame:number,outFrame:number)=>void;
  onSplit: (id:string,timelineFrame:number)=>void;
  onDelete: (id:string)=>void;
  onMute: (id:string,muted:boolean)=>void;
  onRelink: (mediaId:string,file:File)=>void;
};

type Span=ReturnType<typeof clipSpans>[number];
type Mode='move'|'in'|'out';
type Drag={pointerId:number;startX:number;pxPerSec:number;spans:Span[];index:number;mode:Mode;moved:boolean};

function reorderAt({spans,index}:Drag,deltaFrames:number) {
  const clip=spans[index];
  // Compare the leading edge against neighbors in the original layout, not the ripple preview.
  const edge=(deltaFrames>0?clip.endFrame:clip.startFrame)+deltaFrames;
  const center=({startFrame,endFrame}:Span)=>(startFrame+endFrame)/2;
  let next=index;
  while (deltaFrames>0 && next<spans.length-1 && edge>=center(spans[next+1])) next++;
  while (deltaFrames<0 && next>0 && edge<=center(spans[next-1])) next--;
  return next;
}

function trimAt(clip:VideoClip,edge:'in'|'out',deltaFrames:number) {
  const offset=Math.round(deltaFrames);
  return edge==='in'
    ? {...clip,inFrame:Math.min(clip.outFrame-1,Math.max(0,clip.inFrame+offset))}
    : {...clip,outFrame:Math.min(clip.sourceFrames,Math.max(clip.inFrame+1,clip.outFrame+offset))};
}

export function VideoLane({edits,view,spans,selected,onSelect}:{
  edits:VideoEdits;view:View;spans:Span[];selected:string|undefined;onSelect:(id:string)=>void;
}) {
  const lane=useRef<HTMLDivElement>(null);
  const drag=useRef<Drag|null>(null);
  const suppressClick=useRef(false);
  const [preview,setPreview]=useState<Span[]|null>(null);
  const start=(e:PointerEvent<HTMLButtonElement>,index:number,mode:Mode)=>{
    const el=lane.current;
    if (!el || !e.isPrimary || e.button!==0 || drag.current) return;
    // The lane stays mounted and stationary even when clip nodes move during the preview.
    el.setPointerCapture(e.pointerId);
    onSelect(spans[index].id);
    drag.current={pointerId:e.pointerId,startX:e.clientX-el.getBoundingClientRect().left,pxPerSec:view.pxPerSec,
      spans,index,mode,moved:false};
  };
  const delta=(active:Drag,e:PointerEvent<HTMLDivElement>)=>e.clientX-e.currentTarget.getBoundingClientRect().left-active.startX;
  const move=(e:PointerEvent<HTMLDivElement>)=>{
    const active=drag.current;
    if (!active || active.pointerId!==e.pointerId) return;
    const dx=delta(active,e);
    if (!active.moved && Math.abs(dx)<4) return;
    active.moved=true;
    const frames=dx*FPS/active.pxPerSec;
    const clips:VideoClip[]=active.spans.slice();
    if (active.mode==='move') {
      const next=reorderAt(active,frames);
      clips.splice(next,0,...clips.splice(active.index,1));
    } else {
      clips[active.index]=trimAt(clips[active.index],active.mode,frames);
    }
    setPreview(clipSpans(clips));
  };
  const end=(e:PointerEvent<HTMLDivElement>,commit:boolean)=>{
    const active=drag.current;
    if (!active || active.pointerId!==e.pointerId) return;
    drag.current=null;
    suppressClick.current=true;
    setPreview(null);
    if (!commit || !active.moved || active.pxPerSec!==view.pxPerSec) return;
    if (edits.clips.length!==active.spans.length || edits.clips.some((clip,i)=>
      clip.id!==active.spans[i].id || clip.inFrame!==active.spans[i].inFrame || clip.outFrame!==active.spans[i].outFrame || clip.sourceFrames!==active.spans[i].sourceFrames)) return;
    const clip=active.spans[active.index];
    const frames=delta(active,e)*FPS/active.pxPerSec;
    if (active.mode==='move') {
      const next=reorderAt(active,frames);
      if (next!==active.index) edits.onMove(clip.id,next);
    } else {
      const {inFrame,outFrame}=trimAt(clip,active.mode,frames);
      if (inFrame!==clip.inFrame || outFrame!==clip.outFrame) edits.onTrim(clip.id,inFrame,outFrame);
    }
  };

  return <div ref={lane} className="track video-track video-edit-track" role="group" aria-label="Làn video"
    onPointerDownCapture={()=>{suppressClick.current=false;}}
    onPointerMove={move} onPointerUp={e=>end(e,true)} onPointerCancel={e=>end(e,false)} onLostPointerCapture={e=>end(e,false)}
    onClick={e=>{if (suppressClick.current) {e.stopPropagation();suppressClick.current=false;}}}>
    {edits.clips.length===0 && <span className="timeline-empty">Chưa có video</span>}
    {(preview ?? spans).map((clip,index)=>{
      const active=clip.id===selected;
      const width=timeToX((clip.endFrame-clip.startFrame)/FPS,view);
      const handles=active && width>=40;
      const missing=edits.missing.has(clip.mediaId);
      return <div className="video-edit-clip" key={clip.id} data-video-clip-id={clip.id} data-handles={handles||undefined}
        data-missing={missing||undefined}
        style={{left:timeToX(clip.startFrame/FPS,view),width}}>
        <button type="button" className="video-edit-clip-select" title={`${clip.name}${missing?' · Thiếu nguồn':''}`}
          aria-label={clip.name} aria-description={missing?'Thiếu nguồn':undefined} aria-pressed={active}
          onClick={()=>onSelect(clip.id)} onPointerDown={e=>start(e,index,'move')}>
          <span className="video-edit-clip-name">{clip.name}</span>
          {missing && <small className="video-edit-missing" aria-hidden="true">Thiếu nguồn</small>}
        </button>
        {handles && (['in','out'] as const).map(edge=>{
          const label=`Cắt ${edge==='in'?'đầu':'cuối'} ${clip.name}`;
          return <button key={edge} className="video-edit-trim" type="button" data-edge={edge} aria-label={label}
            title={`${label} · Kéo hoặc dùng phím trái/phải`}
            onPointerDown={e=>start(e,index,edge)} onKeyDown={e=>{
              if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight') return;
              e.preventDefault();
              const {inFrame,outFrame}=trimAt(clip,edge,e.key==='ArrowLeft'?-1:1);
              if (inFrame!==clip.inFrame || outFrame!==clip.outFrame) edits.onTrim(clip.id,inFrame,outFrame);
            }}/>;
        })}
      </div>;
    })}
  </div>;
}

function PreciseTrim({clip,onTrim}:{clip:VideoClip;onTrim:VideoEdits['onTrim']}) {
  const makeDraft=()=>({from:String(clip.inFrame),to:String(clip.outFrame),originalIn:clip.inFrame,originalOut:clip.outFrame});
  const [draft,setDraft]=useState(makeDraft);
  if (draft.originalIn!==clip.inFrame || draft.originalOut!==clip.outFrame) setDraft(makeDraft());
  const from=Number(draft.from),to=Number(draft.to);
  const valid=draft.from!=='' && draft.to!=='' && Number.isSafeInteger(from) && Number.isSafeInteger(to) &&
    from>=0 && from<to && to<=clip.sourceFrames && (from!==clip.inFrame || to!==clip.outFrame);
  return <form className="video-edit-trim-form" aria-label="Cắt clip theo khung hình nguồn" onSubmit={e=>{
    e.preventDefault();
    if (valid) onTrim(clip.id,from,to);
  }}>
    <label>Khung đầu <input type="number" min={0} max={clip.sourceFrames-1} step={1} value={draft.from}
      onChange={e=>setDraft({...draft,from:e.currentTarget.value})}/></label>
    <label>Khung cuối <input type="number" min={1} max={clip.sourceFrames} step={1} value={draft.to}
      aria-description="Khung cuối không được tính vào clip" onChange={e=>setDraft({...draft,to:e.currentTarget.value})}/></label>
    <button type="submit" disabled={!valid}>Áp dụng cắt</button>
  </form>;
}

export function VideoClipControls({edits,clip,frame,onSelect}:{
  edits:VideoEdits;clip:Span;frame:number;onSelect:(id:string)=>void;
}) {
  const sourceFile=useRef<HTMLInputElement>(null);
  const index=edits.clips.findIndex(c=>c.id===clip.id);
  const canSplit=Number.isSafeInteger(frame) && clip.startFrame<frame && frame<clip.endFrame;
  const missing=edits.missing.has(clip.mediaId);
  return <div className="video-edit-controls" role="group" aria-label="Chỉnh sửa clip video">
    <div className="video-edit-actions">
      <select aria-label="Clip video" value={clip.id} onChange={e=>onSelect(e.currentTarget.value)}>
        {edits.clips.map((c,i)=><option key={c.id} value={c.id}>{`${i+1}. ${c.name}${edits.missing.has(c.mediaId)?' · Thiếu nguồn':''}`}</option>)}
      </select>
      <button type="button" disabled={index<=0} title="Dời clip sang trái" aria-label="Dời clip sang trái"
        onClick={()=>edits.onMove(clip.id,index-1)}>←</button>
      <button type="button" disabled={index>=edits.clips.length-1} title="Dời clip sang phải" aria-label="Dời clip sang phải"
        onClick={()=>edits.onMove(clip.id,index+1)}>→</button>
      <button type="button" disabled={!canSplit} title={!canSplit?'Đặt đầu phát bên trong clip để tách':undefined}
        onClick={()=>edits.onSplit(clip.id,frame)}>Tách tại đầu phát</button>
      <button type="button" onClick={()=>edits.onMute(clip.id,!clip.muted)}>{clip.muted?'Bật tiếng clip':'Tắt tiếng clip'}</button>
      <button type="button" onClick={()=>edits.onDelete(clip.id)}>Xóa clip</button>
      {missing && <>
        <button type="button" className="video-edit-relink" onClick={()=>sourceFile.current?.click()}>Liên kết lại nguồn</button>
        <input ref={sourceFile} hidden type="file" accept="video/*,.mp4,.mov,.webm,.mkv" data-video-media-id={clip.mediaId}
          onChange={e=>{
            const file=e.currentTarget.files?.[0];
            e.currentTarget.value='';
            if (file) edits.onRelink(clip.mediaId,file);
          }}/>
      </>}
    </div>
    <PreciseTrim key={clip.id} clip={clip} onTrim={edits.onTrim}/>
  </div>;
}
