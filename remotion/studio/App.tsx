import {useEffect,useEffectEvent,useLayoutEffect,useMemo,useReducer,useRef,useState,type FormEvent,type MouseEvent as ReactMouseEvent} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {Scene} from './Scene';
import {activeAt,clipCues,DEMO_SECONDS,FPS,importLyrics,MAX_AUDIO_BYTES,MAX_SECONDS,MAX_VIDEO_BYTES,rangeFromSeconds,setCueStart,setWordStart,timelineLength,validateProject,type RenderRange} from './project.mjs';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {LyricSyncPanel} from '@/components/LyricSyncPanel';
import {canRedo,canUndo,clampView,contentWidth,createEditor,createView,cuesToLrc,editorReducer,fitPxPerSec,MAX_PROJECT_FILE_BYTES,parseProjectFile,serializeProject,timeToX,xToTime,zoomView,type View} from './editor.mjs';

const sample='[00:00.00]Một nhịp thở\n[00:05.00]Rồi chữ bắt đầu chuyển động\n[00:12.00]Mỗi từ theo một nhịp\n[00:22.00]Đến lượt bạn kể chuyện';
const demoCues=importLyrics(sample,DEMO_SECONDS);
const seconds=(n:number)=>n.toFixed(2)+'s';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
type MediaKind='audio'|'video';
type LocalMedia={file:File;src:string;seconds:number};
type RenderJob={phase:string;progress:number;renderedFrames:number|null;totalFrames:number|null;etaSeconds:number|null};
const PHASE_LABEL:Record<string,string>={upload:'Đang tải project lên máy chủ',prepare:'Đang chuẩn bị nhạc và video',bundle:'Đang đóng gói bundle',render:'Đang render khung hình',encoding:'Đang render và mã hoá khung hình',muxing:'Đang ghép âm thanh',done:'Hoàn tất'};
const etaText=(seconds:number)=>seconds<60?`còn ~${seconds} giây`:`còn ~${Math.floor(seconds/60)} phút ${seconds%60} giây`;
const renderStatus=(job:RenderJob)=>[PHASE_LABEL[job.phase] ?? 'Đang render…',`${Math.round(job.progress*100)}%`,job.totalFrames?`${job.renderedFrames}/${job.totalFrames} khung`:null,job.etaSeconds!==null?etaText(job.etaSeconds):null].filter(Boolean).join(' · ');

export default function Studio() {
  const player=useRef<PlayerRef>(null);
  const tapPanel=useRef<HTMLElement>(null);
  const uploadSeq=useRef({audio:0,video:0});
  const mediaUrls=useRef<Partial<Record<MediaKind,string>>>({});
  const [audio,setAudio]=useState<LocalMedia|null>(null);
  const [video,setVideo]=useState<LocalMedia|null>(null);
  const [wide,setWide]=useState(false);
  const [draft,setDraft]=useState(sample);
  const [editor,edit]=useReducer(editorReducer,demoCues,createEditor);
  const cues=editor.cues;
  const [selection,select]=useState<[number,number]|null>([0,0]);
  const [following,setFollowing]=useState(true);
  const [frame,setFrame]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [busy,setBusy]=useState(false);
  const [renderJob,setRenderJob]=useState<RenderJob|null>(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [renderMode,setRenderMode]=useState<'all'|'range'>('all');
  const [rangeStart,setRangeStart]=useState('0');
  const [rangeEnd,setRangeEnd]=useState<string|null>(null);
  const [view,setView]=useState<View>(()=>createView(DEMO_SECONDS,0));
  const timelineSection=useRef<HTMLElement>(null);
  const videoTrack=useRef<HTMLDivElement>(null);
  const lyricTrack=useRef<HTMLDivElement>(null);
  const length=timelineLength(audio?.seconds ?? null,video?.seconds ?? null);
  const videoLength=video ? timelineLength(null,video.seconds) : undefined;
  const duration=length/FPS;
  const endInput=rangeEnd ?? duration.toFixed(3).replace(/\.?0+$/,'');
  let renderRange:RenderRange|undefined;
  let rangeError='';
  if (renderMode==='range') {
    try {renderRange=rangeFromSeconds(rangeStart,endInput,length);}
    catch (e) {rangeError=errText(e);}
  }
  const time=frame/FPS;
  const visibleCues=useMemo(()=>clipCues(cues,duration),[cues,duration]);
  const project=useMemo(()=>({width:wide?1280:720,height:wide?720:1280,durationInFrames:length,cues:visibleCues,videoDurationInFrames:videoLength}),[wide,length,visibleCues,videoLength]);
  const inputProps=useMemo(()=>({project,audioSrc:audio?.src ?? null,videoSrc:video?.src ?? null}),[project,audio,video]);
  const [liveLine,liveWord]=activeAt(visibleCues,time);
  const line=following?Math.max(0,liveLine):selection?.[0] ?? Math.max(0,cues.length-1);
  const cue=cues[line];
  const canTap=following?Boolean(cue?.words.some(w=>!w.confirmed)):Boolean(selection && cue);

  // One view object owns the timeline scale, so the Video and Lời tracks scroll
  // as a single timeline: whichever one scrolls publishes scrollX, and the
  // others follow. The browser clamps scrollLeft; the helpers clamp the scale.
  const trackWidth=()=>lyricTrack.current?.clientWidth ?? 0;
  const fitTimeline=useEffectEvent(()=>{
    const viewportWidth=trackWidth();
    setView(current=>clampView({pxPerSec:fitPxPerSec(duration,viewportWidth),scrollX:current.scrollX},{duration,viewportWidth}));
  });
  const zoomTimeline=useEffectEvent((factor:number,anchorTime?:number)=>{
    const viewportWidth=trackWidth();
    setView(current=>zoomView(current,{factor,duration,viewportWidth,anchorTime:anchorTime ?? time}));
  });
  const scrollTimeline=useEffectEvent((scrollX:number)=>setView(current=>current.scrollX===scrollX?current:{...current,scrollX}));
  useLayoutEffect(()=>{fitTimeline();},[duration]);
  useEffect(()=>{
    for (const track of [videoTrack.current,lyricTrack.current]) if (track && track.scrollLeft!==view.scrollX) track.scrollLeft=view.scrollX;
  },[view.scrollX]);
  useEffect(()=>{
    // Undoing an edit that removed lines must not leave the panel pointing past
    // the end of the lyrics.
    if (selection && selection[0]>=cues.length) select(cues.length?[cues.length-1,0]:null);
  },[cues,selection]);


  useEffect(()=>{
    const p=player.current;
    if (!p) return;
    const update=()=>setFrame(p.getCurrentFrame());
    const play=()=>setPlaying(true);
    const pause=()=>setPlaying(false);
    p.addEventListener('frameupdate',update);
    p.addEventListener('seeked',update);
    p.addEventListener('play',play);
    p.addEventListener('pause',pause);
    p.addEventListener('ended',pause);
    return ()=>{
      p.removeEventListener('frameupdate',update);p.removeEventListener('seeked',update);
      p.removeEventListener('play',play);p.removeEventListener('pause',pause);p.removeEventListener('ended',pause);
    };
  },[]);

  function seek(next:number) {
    const clamped=Math.max(0,Math.min(length-1,Math.round(next)));
    player.current?.seekTo(clamped);
    setFrame(clamped);
  }
  function changeLyrics(text:string) {
    try {edit({type:'commit',cues:text.trim()?importLyrics(text,duration,MAX_SECONDS):[]});select([0,0]);setFollowing(true);setError('');setNotice('Đã cập nhật lời.');}
    catch(e){setError(errText(e));}
  }
  function applyLyrics(e:FormEvent) {e.preventDefault();changeLyrics(draft);}
  async function chooseLrc(file:File) {
    try {
      if(file.size>32_768) throw Error('File LRC tối đa 32 KB.');
      const text=await file.text();setDraft(text);changeLyrics(text);
    } catch(e){setError(errText(e));}
  }
  function resetPlayhead() {
    player.current?.pause();
    seek(0);
    select([0,0]);
  }
  function setLocalMedia(kind:MediaKind,media:LocalMedia|null) {
    const previous=mediaUrls.current[kind];
    mediaUrls.current[kind]=media?.src;
    if(kind==='audio')setAudio(media);else setVideo(media);
    // Fast Refresh reruns effect cleanup without clearing editor state.
    // Revoke when replacing/removing a file instead; document unload frees the rest.
    if(previous) window.setTimeout(()=>URL.revokeObjectURL(previous),0);
  }
  async function chooseMedia(kind:MediaKind,file:File) {
    const seq=++uploadSeq.current[kind];
    const isAudio=kind==='audio';
    setError('');
    if(file.size>(isAudio?MAX_AUDIO_BYTES:MAX_VIDEO_BYTES)) {
      setError(isAudio?'File nhạc tối đa 25 MiB.':'File video tối đa 100 MiB.');
      return;
    }
    const src=URL.createObjectURL(file);
    const probe=document.createElement(kind);
    const unreadable=isAudio?'Không đọc được nhạc. Hãy thử MP3 hoặc WAV.':'Không đọc được video. Hãy thử MP4 (H.264) hoặc WebM.';
    try {
      const mediaSeconds=await new Promise<number>((resolve,reject)=>{
        const timer=window.setTimeout(()=>reject(Error(unreadable)),10000);
        probe.onloadedmetadata=()=>{clearTimeout(timer);resolve(probe.duration);};
        probe.onerror=()=>{clearTimeout(timer);reject(Error(unreadable));};
        probe.preload='metadata';probe.src=src;
      });
      if(seq!==uploadSeq.current[kind]){URL.revokeObjectURL(src);return;}
      if(!Number.isFinite(mediaSeconds) || mediaSeconds<1/FPS || (probe instanceof HTMLVideoElement && !probe.videoWidth)) throw Error(unreadable);
      if(mediaSeconds>MAX_SECONDS) throw Error('Studio hỗ trợ timeline tối đa 2 giờ.');
      resetPlayhead();setLocalMedia(kind,{file,src,seconds:mediaSeconds});
      setNotice(isAudio?'Đã nạp nhạc.':'Đã nạp video.');
    } catch(e){URL.revokeObjectURL(src);if(seq===uploadSeq.current[kind])setError(errText(e));}
    finally {probe.onloadedmetadata=null;probe.onerror=null;probe.removeAttribute('src');probe.load();}
  }
  function removeMedia(kind:MediaKind) {
    ++uploadSeq.current[kind];
    resetPlayhead();
    setLocalMedia(kind,null);
    setError('');setNotice('');
  }
  function togglePlayback(e:ReactMouseEvent<HTMLButtonElement>) {
    const p=player.current;
    if (!p) return;
    const startWithPointer=e.detail>0 && !p.isPlaying();
    p.toggle(e);
    // Keep a pointer click from leaving Space bound to the transport button.
    // Keyboard activation retains focus on Play, and no viewport scroll is needed.
    if (startWithPointer && cue) tapPanel.current?.focus({preventScroll:true});
  }
  function lockWord(word:number) {
    setFollowing(false);
    select([line,word]);
  }
  function enterMarkMode() {
    if (!following || !cue) return;
    const unmarked=cue.words.findIndex(w=>!w.confirmed);
    lockWord(unmarked<0?Math.max(0,liveWord):unmarked);
  }
  function pickLine(i:number) {
    if (!cues[i]) return;
    setFollowing(false);
    select([i,0]);
    seek((cues[i].start-0.3)*FPS);
  }
  function editLineStart(value:number) {
    if (!cue) return false;
    try {
      edit({type:'commit',cues:setCueStart(cues,line,value,value>=duration || cue.start>=duration ? MAX_SECONDS : duration)});
      setError('');seek(value*FPS);
      return true;
    } catch(err){setError(errText(err));return false;}
  }
  function tap() {
    const now=(player.current?.getCurrentFrame() ?? frame)/FPS;
    let target=selection;
    if (following) {
      const i=Math.max(0,activeAt(visibleCues,now)[0]);
      const j=cues[i]?.words.findIndex(w=>!w.confirmed) ?? -1;
      target=j<0?null:[i,j];
    }
    if (!target) return;
    const [i,j]=target;
    try {
      edit({type:'commit',cues:setWordStart(cues,i,j,now,duration)});
      setFollowing(false);
      if(j+1<cues[i].words.length)select([i,j+1]);
      else if(i+1<cues.length)select([i+1,0]);
      else select(null);
      setError('');
    } catch(e){setError(errText(e));}
  }
  function undo(){if(canUndo(editor))edit({type:'undo'});}
  function redo(){if(canRedo(editor))edit({type:'redo'});}
  function saveProject() {
    setError('');setNotice('');
    try {
      const json=serializeProject({project,renderRange,media:{audio:audio?.file.name ?? null,video:video?.file.name ?? null}});
      const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='remain-studio-project.json';a.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);
      setNotice('Đã lưu project (.json). Khi mở lại, hãy chọn lại nhạc và video từ máy.');
    } catch(e){setError(errText(e));}
  }
  async function loadProject(file:File) {
    try {
      if(file.size>MAX_PROJECT_FILE_BYTES) throw Error('File project tối đa 1 MiB.');
      const loaded=parseProjectFile(await file.text());
      edit({type:'reset',cues:loaded.cues});
      setDraft(cuesToLrc(loaded.cues));
      setWide(loaded.width===1280);
      if(loaded.renderRange){setRenderMode('range');setRangeStart(String(loaded.renderRange.startFrame/FPS));setRangeEnd(String(loaded.renderRange.endFrame/FPS));}
      else {setRenderMode('all');setRangeStart('0');setRangeEnd(null);}
      resetPlayhead();setFollowing(true);
      setError('');
      setNotice(`Đã nạp ${file.name}. ${loaded.media.audio||loaded.media.video?'Hãy chọn lại nhạc và video từ máy.':''}`);
    } catch(e){setError(errText(e));}
  }
  const pollRenderJob=useEffectEvent(async()=>{
    try {
      const response=await fetch('/api/render/progress',{cache:'no-store'});
      if(!response.ok)return;
      const job=await response.json();
      if(!job?.active)return;
      setRenderJob({phase:job.phase,progress:job.progress,renderedFrames:job.renderedFrames??null,
        totalFrames:job.totalFrames??null,etaSeconds:Number.isFinite(job.etaMs)?Math.max(0,Math.round(job.etaMs/1000)):null});
    } catch {
      // A dropped poll is retried on the next tick; the render POST stays the source of truth.
    }
  });
  async function exportClip() {
    setError('');setNotice('');setBusy(true);
    setRenderJob({phase:'upload',progress:0,renderedFrames:null,totalFrames:null,etaSeconds:null});
    // The render POST only answers with the MP4 at the end, so progress is read
    // from a side channel while that request stays open.
    const poll=window.setInterval(()=>void pollRenderJob(),700);
    try {
      const data=new FormData();data.set('project',JSON.stringify(validateProject({...project,renderRange})));
      if(audio)data.set('audio',audio.file);
      if(video)data.set('video',video.file);
      const response=await fetch('/api/render',{method:'POST',body:data});
      if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error || `Không xuất được video (HTTP ${response.status}).`);}
      if(!response.headers.get('content-type')?.startsWith('video/mp4'))throw Error('Máy chủ không trả về MP4.');
      const url=URL.createObjectURL(await response.blob());
      const a=document.createElement('a');a.href=url;a.download=renderRange?'remain-studio-segment.mp4':'remain-studio.mp4';a.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('Đã xuất MP4.');
    } catch(e){setError(errText(e));}
    finally {window.clearInterval(poll);setRenderJob(null);setBusy(false);}
  }

  const tapFromKeyboard = useEffectEvent((e: KeyboardEvent) => {
    const space=e.code==='Space';
    if (e.defaultPrevented || e.isComposing || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (!space && e.key.toLowerCase()!=='t')) return;
    if (e.target instanceof HTMLElement) {
      if (e.target.isContentEditable || e.target.closest('input:not([type=range]), textarea, select:not(#cue-picker)')) return;
      // Keep Space activation for regular buttons, e.g. Export. During
      // playback Space taps even if the transport Play button retains focus.
      if (space && e.target.closest('select, a, button') && !e.target.closest('.words button') && !(player.current?.isPlaying() && e.target.closest('.play-toggle'))) return;
    }
    if (!cue || (!following && !selection)) return;
    e.preventDefault();
    tap();
  });
  const editorFromKeyboard = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    const key = e.key.toLowerCase();
    const modifier = e.ctrlKey || e.metaKey;
    // Ctrl+Z typed in the lyrics field stays a text undo, not a cue undo.
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input:not([type=range]), textarea, select'));
    if (modifier && (key === 'z' || key === 'y')) {
      if (typing) return;
      if (key === 'y' && !e.shiftKey || key === 'z' && e.shiftKey) { if (canRedo(editor)) { e.preventDefault(); edit({type:'redo'}); } }
      else if (key === 'z' && canUndo(editor)) { e.preventDefault(); edit({type:'undo'}); }
      return;
    }
    if (modifier || e.altKey || typing) return;
    if (key === '+' || key === '=') { e.preventDefault(); zoomTimeline(1.4); }
    else if (key === '-') { e.preventDefault(); zoomTimeline(1 / 1.4); }
    else if (key === 'f') { e.preventDefault(); fitTimeline(); }
  });
  const zoomFromWheel = useEffectEvent((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = lyricTrack.current?.getBoundingClientRect();
    zoomTimeline(e.deltaY < 0 ? 1.2 : 1 / 1.2, rect ? xToTime(view.scrollX + (e.clientX - rect.left), view) : time);
  });
  useEffect(() => {
    // The focused word button may disappear when the next line is shorter.
    const onKeyDown = (e: KeyboardEvent) => { tapFromKeyboard(e); editorFromKeyboard(e); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => {
    const el = timelineSection.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => zoomFromWheel(e);
    // Ctrl/⌘ + wheel zooms the timeline around the cursor instead of the page.
    el.addEventListener('wheel', onWheel, {passive: false});
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return <div className="studio">
    <header className="topbar">
      <div className="identity"><span className="mark" aria-hidden="true">R</span><div><h1>Remain Studio</h1><span>VIDEO CHỮ CHUYỂN ĐỘNG</span></div></div>
      <div className="toolbar"><label>Khung hình<select value={wide?'wide':'tall'} onChange={e=>setWide(e.target.value==='wide')}><option value="tall">9:16 · Dọc</option><option value="wide">16:9 · Ngang</option></select></label>
      <Button type="button" className="px-3 font-semibold min-[781px]:px-4" disabled={busy || Boolean(rangeError) || (!visibleCues.length && !audio && !video)} onClick={exportClip}>{busy?(renderJob?`Đang render… ${Math.round(renderJob.progress*100)}%`:'Đang render…'):'Xuất MP4'}</Button></div>
    </header>
    <main className="workspace mt-3 grid grid-cols-1 gap-3 min-[781px]:grid-cols-[minmax(0,1fr)_minmax(296px,354px)]">
      <section className="viewer" aria-label="Preview">
        <div className="section-bar"><h2>Preview</h2><span className="badge">Aurora</span></div>
        <div className={'stage '+(wide?'wide':'tall')}>
          <Player ref={player} component={Scene} inputProps={inputProps} fps={FPS} durationInFrames={length} compositionWidth={project.width} compositionHeight={project.height} style={{width:'100%',aspectRatio:`${project.width} / ${project.height}`}} controls={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense />
        </div>
        <div className="transport"><Button type="button" variant="outline" size="icon" onClick={()=>seek(0)} title="Về đầu clip" aria-label="Về đầu clip">⏮</Button><Button type="button" variant="outline" className="play-toggle" onClick={togglePlayback}>{playing?'Tạm dừng':'Phát'}</Button><output>{seconds(time)} <span>/ {seconds(duration)}</span></output></div>
      </section>
      <aside className="inspector" aria-label="Nội dung project">
        <LyricSyncPanel panelRef={tapPanel} cues={cues} line={line} selectedWord={following?null:selection?.[1] ?? null}
          liveLine={liveLine} liveWord={liveWord} time={time} playing={playing} following={following}
          complete={!following && selection===null} canTap={canTap} onFollow={()=>setFollowing(true)}
          onMarkMode={enterMarkMode} onLine={pickLine} onWord={lockWord} onLineStart={editLineStart} onTap={tap}/>
        <section className="panel"><div className="section-bar"><h2>01 · Media</h2><span className="subtle">Nhạc 25 MiB · Video 100 MiB</span></div>
          <label htmlFor="audio-file">Chọn nhạc từ máy</label><Input id="audio-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseMedia('audio',file);}}/>
          {audio && <div className="flex min-w-0 items-center justify-between gap-2.5"><span className="filename">{audio.file.name}</span><Button type="button" variant="outline" size="sm" onClick={()=>removeMedia('audio')}>Gỡ nhạc</Button></div>}
          <label htmlFor="video-file">Chọn video nền</label><Input id="video-file" type="file" accept="video/*,.mp4,.mov,.webm,.mkv" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseMedia('video',file);}}/>
          {video && <div className="flex min-w-0 items-center justify-between gap-2.5"><span className="filename">{video.file.name}</span><Button type="button" variant="outline" size="sm" onClick={()=>removeMedia('video')}>Gỡ video</Button></div>}
          {video && <p className="hint">{audio?'Nhạc riêng thay âm thanh gốc của video.':'Đang dùng âm thanh gốc của video.'}</p>}
        </section>
        <section className="panel"><div className="section-bar"><h2>02 · Lời</h2><label className="filebutton">Nhập .LRC<input type="file" accept=".lrc,text/plain" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseLrc(file);}}/></label></div>
          <form onSubmit={applyLyrics}><label htmlFor="lyrics">Dán lời, mỗi câu một dòng, hoặc dán LRC</label><Textarea id="lyrics" className="field-sizing-fixed" rows={5} maxLength={16000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" variant="outline">Áp dụng lời</Button></form>
        </section>
        <section className="panel"><div className="section-bar"><h2>04 · Project</h2><span className="subtle">JSON · 1 MiB</span></div>
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={saveProject}>Lưu project</Button><label className="filebutton">Nạp project<input id="project-file" type="file" accept=".json,application/json" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void loadProject(file);}}/></label></div>
          <p className="hint">File lưu lời, các mốc từ, khổ khung và phạm vi xuất. Nhạc cùng video không nằm trong file: hãy chọn lại đúng hai tệp đó khi mở project.</p>
        </section>
      </aside>
    </main>
    <section className="timeline" ref={timelineSection} aria-label="Timeline">
      <div className="section-bar"><h2>Timeline</h2><div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={!canUndo(editor)} onClick={undo} title="Hoàn tác (Ctrl+Z)">Hoàn tác</Button>
        <Button type="button" variant="outline" size="sm" disabled={!canRedo(editor)} onClick={redo} title="Làm lại (Ctrl+Shift+Z)">Làm lại</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>zoomTimeline(1/1.4)} aria-label="Thu nhỏ timeline" title="Thu nhỏ (-)">−</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>zoomTimeline(1.4)} aria-label="Phóng to timeline" title="Phóng to (+)">+</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>fitTimeline()} title="Vừa khung (F)">Vừa khung</Button>
        <span className="subtle">{seconds(time)} / {seconds(duration)} · {FPS} fps</span></div></div>
      <div className="lane"><span>Playhead</span><input id="timeline" aria-label="Vị trí timeline" type="range" min={0} max={length-1} step={1} value={frame} onChange={e=>seek(Number(e.target.value))}/></div>
      <div className="lane"><span>Video</span><div ref={videoTrack} className="track video-track scrollable" onScroll={e=>scrollTimeline(e.currentTarget.scrollLeft)}><div className="track-strip" style={{width:`${contentWidth(duration,view)}px`}}>{video && <span style={{width:`${timeToX((videoLength ?? 0)/FPS,view)}px`}}>{video.file.name}</span>}</div></div></div>
      <div className="lane"><span>Nhạc</span><div className={'audio-lane '+(audio?'loaded':'')}>{audio?audio.file.name:'Chưa có nhạc'}</div></div>
      <div className="lane"><span>Lời</span><div ref={lyricTrack} className="track scrollable" onScroll={e=>scrollTimeline(e.currentTarget.scrollLeft)}><div className="track-strip" style={{width:`${contentWidth(duration,view)}px`}}>{visibleCues.map((c,i)=><button key={i} className={i===liveLine?'live':''} title={`${c.text} · ${seconds(c.start)}`} aria-label={`Tua đến dòng ${i+1}: ${c.text}`} onClick={()=>{select([i,0]);seek(Math.ceil(c.start*FPS));}} style={{left:`${timeToX(c.start,view)}px`,width:`${Math.max(28,timeToX((visibleCues[i+1]?.start??duration)-c.start,view))}px`}}>{c.text}</button>)}</div></div></div>
    </section>
    <section className="export-options" aria-label="Thiết lập xuất video">
      <div className="section-bar"><h2>Thiết lập xuất</h2><output id="render-duration">{rangeError?'—':seconds((renderRange?renderRange.endFrame-renderRange.startFrame:length)/FPS)}</output></div>
      {busy && <div className="render-progress"><progress value={Math.round((renderJob?.progress ?? 0)*100)} max={100}/><span role="status" aria-live="polite">{renderJob?renderStatus(renderJob):'Đang chuẩn bị render…'}</span></div>}
      <div className="range-fields flex flex-wrap items-end gap-3">
        <label>Phạm vi xuất<select value={renderMode} onChange={e=>setRenderMode(e.target.value==='range'?'range':'all')}><option value="all">Toàn bộ timeline</option><option value="range">Một đoạn</option></select></label>
        {renderMode==='range' && <>
          <div><label>Bắt đầu (giây)<Input className="w-[105px]" type="number" min="0" max={duration} step="any" value={rangeStart} onChange={e=>setRangeStart(e.target.value)}/></label><Button type="button" variant="outline" onClick={()=>setRangeStart(time.toFixed(3))}>Lấy mốc đầu</Button></div>
          <div><label>Kết thúc (giây)<Input className="w-[105px]" type="number" min="0" max={duration} step="any" value={endInput} onChange={e=>setRangeEnd(e.target.value)}/></label><Button type="button" variant="outline" onClick={()=>setRangeEnd(time.toFixed(3))}>Lấy mốc cuối</Button></div>
        </>}
      </div>
      {rangeError && <p className="error" role="status">{rangeError}</p>}
    </section>
    <footer><span>Render bằng máy đang chạy Studio · MP4 / H.264</span><div role={error?'alert':'status'} className={error?'error':''}>{error || (busy?'Đang render. Giữ tab mở để tải video.':notice)}</div></footer>
  </div>;
}