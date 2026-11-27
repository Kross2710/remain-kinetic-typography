import {useEffect,useEffectEvent,useLayoutEffect,useMemo,useReducer,useRef,useState,type FormEvent,type MouseEvent as ReactMouseEvent} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {Scene} from './Scene';
import {activeAt,clipCues,DEMO_SECONDS,FPS,importLyrics,MAX_AUDIO_BYTES,MAX_SECONDS,MAX_VIDEO_BYTES,rangeFromSeconds,setCueStart,setWordStart,timelineLength,validateProject,type RenderRange} from './project.mjs';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {LyricSyncPanel} from '@/components/LyricSyncPanel';
import {EffectsPanel} from '@/components/EffectsPanel';
import {TimelineTracks} from '@/components/TimelineTracks';
import {MAX_SECTIONS,PRESETS,type Effect,type SectionKind,type SongSection} from './effects.mjs';
import {canRedo,canUndo,clampView,contentWidth,createEditor,createView,cuesToLrc,editorReducer,MAX_PROJECT_FILE_BYTES,parseProjectFile,serializeProject,xToTime,zoomView,type View} from './editor.mjs';
import {buildSessionRecord,clearSession,forgetJobId,loadSession,openStudioDb,QUOTA_NOTICE,readJobId,rememberJobId,saveSession,storedLengthFrames,type SessionSnapshot} from './session.mjs';

const sample='[00:00.00]Một nhịp thở\n[00:05.00]Rồi chữ bắt đầu chuyển động\n[00:12.00]Mỗi từ theo một nhịp\n[00:22.00]Đến lượt bạn kể chuyện';
const demoCues=importLyrics(sample,DEMO_SECONDS);
const seconds=(n:number)=>n.toFixed(2)+'s';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
type MediaKind='audio'|'video';
type LocalMedia={file:File;src:string;seconds:number};
type RenderJob={phase:string;progress:number;renderedFrames:number|null;totalFrames:number|null;etaSeconds:number|null};
type RenderJobResponse={id:string;status:string;phase:string;progress:number;renderedFrames:number|null;totalFrames:number|null;etaMs:number|null;error?:string};
const PHASE_LABEL:Record<string,string>={upload:'Đang tải project lên máy chủ',prepare:'Đang chuẩn bị nhạc và video',bundle:'Đang đóng gói bundle',render:'Đang render khung hình',encoding:'Đang render và mã hoá khung hình',muxing:'Đang ghép âm thanh',done:'Hoàn tất',cancelled:'Đã huỷ render',failed:'Render thất bại'};
const etaText=(seconds:number)=>seconds<60?`còn ~${seconds} giây`:`còn ~${Math.floor(seconds/60)} phút ${seconds%60} giây`;
const renderStatus=(job:RenderJob)=>[PHASE_LABEL[job.phase] ?? 'Đang render…',`${Math.round(job.progress*100)}%`,job.totalFrames?`${job.renderedFrames}/${job.totalFrames} khung`:null,job.etaSeconds!==null?etaText(job.etaSeconds):null].filter(Boolean).join(' · ');

export default function Studio() {
  const player=useRef<PlayerRef>(null);
  const tapPanel=useRef<HTMLElement>(null);
  const uploadSeq=useRef({audio:0,video:0});
  const mediaUrls=useRef<Partial<Record<MediaKind,string>>>({});
  const mediaState=useRef<{audio:LocalMedia|null; video:LocalMedia|null}>({audio:null,video:null});
  const sessionRestoring=useRef(false);
  const [audio,setAudio]=useState<LocalMedia|null>(null);
  const [video,setVideo]=useState<LocalMedia|null>(null);
  const [wide,setWide]=useState(false);
  const [effect,setEffect]=useState<Effect>(PRESETS.classic);
  const [sections,setSections]=useState<SongSection[]>([]);
  const [showSections,setShowSections]=useState(false);
  const [draft,setDraft]=useState(sample);
  const [inspectorTab,setInspectorTab]=useState('sync');
  const [editor,edit]=useReducer(editorReducer,demoCues,createEditor);
  const cues=editor.cues;
  const [selection,select]=useState<[number,number]|null>([0,0]);
  const [following,setFollowing]=useState(true);
  const [frame,setFrame]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [busy,setBusy]=useState(false);
  const [renderJob,setRenderJob]=useState<RenderJob|null>(null);
  const activeJobId=useRef<string|null>(null);
  const uploadAbort=useRef<AbortController|null>(null);
  const sessionDb=useRef<IDBDatabase|null>(null);
  const restoredView=useRef<View|null>(null);
  // Bumped when a session is applied, so a restored zoom is consumed even when
  // the restored timeline is the same length the page already had.
  const [sessionApplied,setSessionApplied]=useState(0);
  const autosaveTimer=useRef(0);
  const [sessionSavedAt,setSessionSavedAt]=useState<number|null>(null);
  const [sessionQuota,setSessionQuota]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [renderMode,setRenderMode]=useState<'all'|'range'>('all');
  // Off by default: the CPU render is the reference output. The server only reads
  // this as a boolean flag and turns it into Remotion's chromiumOptions.gl.
  const [gpuExport,setGpuExport]=useState(false);
  const [rangeStart,setRangeStart]=useState('0');
  const [rangeEnd,setRangeEnd]=useState<string|null>(null);
  const [view,setView]=useState<View>(()=>createView(DEMO_SECONDS,0));
  const timelineSection=useRef<HTMLElement>(null);
  const timelineViewport=useRef<HTMLDivElement>(null);
  const [timelineWidth,setTimelineWidth]=useState(0);
  const timelineFitted=useRef(true);
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
  const project=useMemo(()=>({width:wide?1280:720,height:wide?720:1280,durationInFrames:length,cues:visibleCues,videoDurationInFrames:videoLength,effect,sections:sections.filter(s=>s.start<duration),showSections}),[wide,length,visibleCues,videoLength,effect,sections,duration,showSections]);
  const inputProps=useMemo(()=>({project,audioSrc:audio?.src ?? null,videoSrc:video?.src ?? null}),[project,audio,video]);
  const [liveLine,liveWord]=activeAt(visibleCues,time);
  const line=following?Math.max(0,liveLine):selection?.[0] ?? Math.max(0,cues.length-1);
  const cue=cues[line];
  const targetWord=following?cue?.words.find(w=>!w.confirmed):selection?cue?.words[selection[1]]:undefined;
  const canTap=Boolean(targetWord);
  const canReplay=Boolean(cue && cue.start<duration);

  const trackWidth=()=>timelineViewport.current?.clientWidth ?? 0;
  const fitTimeline=()=>{
    timelineFitted.current=true;
    setView(createView(duration,trackWidth()));
  };
  const applyTimelineView=useEffectEvent(()=>{
    const saved=restoredView.current;
    restoredView.current=null;
    if (saved) {
      timelineFitted.current=false;
      setView(clampView(saved,{duration,viewportWidth:trackWidth()}));
    } else fitTimeline();
  });
  const zoomTimeline=(factor:number,anchorTime?:number)=>{
    const viewportWidth=trackWidth();
    const options={factor,duration,viewportWidth,anchorTime:anchorTime ?? time};
    if (zoomView(view,options)===view) return;
    timelineFitted.current=false;
    setView(current=>zoomView(current,options));
  };
  const scrollTimeline=(scrollX:number)=>setView(current=>current.scrollX===scrollX?current:{...current,scrollX});
  const resizeTimeline=useEffectEvent((width:number)=>{
    setTimelineWidth(width);
    if (timelineFitted.current) setView(createView(duration,width));
  });
  useLayoutEffect(()=>{
    const el=timelineViewport.current;
    if (!el) return;
    let width=el.clientWidth;
    setTimelineWidth(width);
    const observe=new ResizeObserver(()=>{
      if (el.clientWidth===width) return;
      width=el.clientWidth;
      resizeTimeline(width);
    });
    observe.observe(el);
    return ()=>observe.disconnect();
  },[]);
  useLayoutEffect(()=>{applyTimelineView();},[duration,sessionApplied]);
  const stripWidth=contentWidth(duration,view);
  useLayoutEffect(()=>{
    const el=timelineViewport.current;
    if (!el) return;
    if (Math.abs(el.scrollLeft-view.scrollX)>=0.5) el.scrollLeft=view.scrollX;
    const scrollX=el.scrollLeft;
    setView(current=>current.scrollX===scrollX?current:{...current,scrollX});
  },[view.scrollX,stripWidth,timelineWidth]);
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
    mediaState.current[kind]=media;
    if(kind==='audio')setAudio(media);else setVideo(media);
    // Picking or removing a file is worth saving at once: the blob is the part
    // a reload cannot recover on its own.
    void persistSession({withMedia:true});
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
    if (startWithPointer && cue && inspectorTab==='sync') tapPanel.current?.focus({preventScroll:true});
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
  function pickTimelineCue(i:number) {
    const c=cues[i];
    if (!c) return;
    const nextWord=c.words.findIndex(w=>!w.confirmed);
    setFollowing(false);
    select([i,Math.max(0,nextWord)]);
    seek(Math.ceil(c.start*FPS));
  }
  function replayLine() {
    if (!cue || !canReplay) return;
    seek((cue.start-0.3)*FPS);
    player.current?.play();
    tapPanel.current?.focus({preventScroll:true});
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
  function editEffect(value:Effect,scope:'project'|'line') {
    if(scope==='project')setEffect(value);
    else if(cue)edit({type:'commit',cues:cues.map((c,i)=>i===line?{...c,effect:value}:c)});
  }
  function resetLineEffect() {
    if(!cue?.effect)return;
    edit({type:'commit',cues:cues.map((c,i)=>i===line?{...c,effect:undefined}:c)});
  }
  const emphasisIndex=!following && selection?.[0]===line ? selection[1] : -1;
  const emphasisWord=cue?.words[emphasisIndex];
  function toggleEmphasis() {
    if(!emphasisWord)return;
    edit({type:'commit',cues:cues.map((c,i)=>i!==line?c:{...c,words:c.words.map((w,j)=>j!==emphasisIndex?w:{...w,emphasis:!w.emphasis})})});
  }
  function addSection(kind:SectionKind) {
    const start=(player.current?.getCurrentFrame() ?? frame)/FPS;
    setSections(previous=>{
      if(previous.length>=MAX_SECTIONS && !previous.some(s=>s.start===start))return previous;
      return [...previous.filter(s=>s.start!==start),{start,kind}].sort((a,b)=>a.start-b.start);
    });
  }
  function saveProject() {
    setError('');setNotice('');
    try {
      const json=serializeProject({project:{...project,durationInFrames:storedLengthFrames({length,cues}),cues,sections},renderRange,media:{audio:audio?.file.name ?? null,video:video?.file.name ?? null}});
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
      setEffect(loaded.effect ?? PRESETS.classic);
      setSections(loaded.sections ?? []);
      setShowSections(loaded.showSections===true);
      if(loaded.renderRange){setRenderMode('range');setRangeStart(String(loaded.renderRange.startFrame/FPS));setRangeEnd(String(loaded.renderRange.endFrame/FPS));}
      else {setRenderMode('all');setRangeStart('0');setRangeEnd(null);}
      resetPlayhead();setFollowing(true);
      setError('');
      setNotice(`Đã nạp ${file.name}. ${loaded.media.audio||loaded.media.video?'Hãy chọn lại nhạc và video từ máy.':''}`);
    } catch(e){setError(errText(e));}
  }
  const showRenderJob=useEffectEvent((job:RenderJobResponse)=>{
    setRenderJob({phase:job.phase,progress:job.progress,renderedFrames:job.renderedFrames??null,
      totalFrames:job.totalFrames??null,etaSeconds:job.etaMs!==null&&Number.isFinite(job.etaMs)?Math.max(0,Math.round(job.etaMs/1000)):null});
  });
  // A render is a server-side job: POST only hands back an id, the client then
  // watches that id until it settles and downloads the video from the job.
  const watchRenderJob=useEffectEvent((id:string)=>new Promise<RenderJobResponse>((resolve,reject)=>{
    const tick=async()=>{
      try {
        const response=await fetch(`/api/render/jobs/${id}`,{cache:'no-store'});
        if(response.status===404){stop();reject(Error('Render đã mất vì Studio khởi động lại. Hãy xuất lại.'));return;}
        if(!response.ok)return;
        const job:RenderJobResponse=await response.json();
        showRenderJob(job);
        if(job.status!=='running'){stop();resolve(job);}
      } catch {
        // A dropped poll is retried on the next tick; the job keeps running either way.
      }
    };
    const interval=window.setInterval(tick,700);
    const stop=()=>window.clearInterval(interval);
    void tick();
  }));
  function cancelRender() {
    const id=activeJobId.current;
    if(id){
      void fetch(`/api/render/jobs/${id}/cancel`,{method:'POST'})
        .then(response=>{if(!response.ok)setError('Không huỷ được render.');})
        .catch(()=>setError('Không huỷ được render.'));
      return;
    }
    // While the project is still being uploaded there is no job id yet, so the
    // only thing that can be stopped is the request itself.
    uploadAbort.current?.abort();
  }
  async function exportClip() {
    setError('');setNotice('');setBusy(true);
    setRenderJob({phase:'upload',progress:0,renderedFrames:null,totalFrames:null,etaSeconds:null});
    const upload=new AbortController();
    uploadAbort.current=upload;
    try {
      const data=new FormData();data.set('project',JSON.stringify(validateProject({...project,renderRange})));
      if(audio)data.set('audio',audio.file);
      if(video)data.set('video',video.file);
      if(gpuExport)data.set('gpu','1');
      const started=await fetch('/api/render',{method:'POST',body:data,signal:upload.signal});
      if(!started.ok){const body=await started.json().catch(()=>({}));throw Error(body.error || `Không gửi được project (HTTP ${started.status}).`);}
      const {jobId}=await started.json();
      activeJobId.current=jobId;
      // The id is the only handle to a render that outlives this page.
      rememberJobId(jobId);
      const finished=await watchRenderJob(jobId);
      if(finished.status==='cancelled'){setNotice('Đã huỷ render.');return;}
      if(finished.status!=='done')throw Error(finished.error || 'Không xuất được video.');
      await downloadJobFile(jobId);
      setNotice('Đã xuất MP4.');
    } catch(e){
      if(upload.signal.aborted)setNotice('Đã huỷ trước khi render bắt đầu.');
      else setError(errText(e));
    }
    finally {activeJobId.current=null;forgetJobId();uploadAbort.current=null;setRenderJob(null);setBusy(false);}
  }

  const downloadJobFile=useEffectEvent(async (id:string)=>{
    const file=await fetch(`/api/render/jobs/${id}/file`,{cache:'no-store'});
    if(!file.ok)throw Error('Không tải được video đã render.');
    const url=URL.createObjectURL(await file.blob());
    const a=document.createElement('a');a.href=url;a.download=renderRange?'remain-studio-segment.mp4':'remain-studio.mp4';a.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  // A render that was still running when the page went away is running on the
  // server; the job id kept in sessionStorage is enough to pick the bar back up
  // and take the video once it lands.
  const resumeRenderJob=useEffectEvent(async (id:string)=>{
    setBusy(true);
    // The reattached id has to be the cancel target too: the button appears
    // because the job is busy, so it must be able to stop that job.
    activeJobId.current=id;
    setRenderJob({phase:'prepare',progress:0,renderedFrames:null,totalFrames:null,etaSeconds:null});
    try {
      const finished=await watchRenderJob(id);
      if(finished.status==='done'){await downloadJobFile(id);setNotice('Đã tải video của render đang chạy trước khi nạp lại trang.');}
      else if(finished.status==='cancelled')setNotice('Render đã bị huỷ.');
      else setError(finished.error || 'Render đã mất.');
    } catch(e){setError(errText(e));}
    finally {activeJobId.current=null;forgetJobId();setRenderJob(null);setBusy(false);}
  });

  const applySession=useEffectEvent((snapshot:SessionSnapshot)=>{
    const loaded=parseProjectFile(snapshot.record.json);
    edit({type:'reset',cues:loaded.cues});
    setDraft(cuesToLrc(loaded.cues));
    setWide(loaded.width===1280);
    setEffect(loaded.effect ?? PRESETS.classic);
    setSections(loaded.sections ?? []);
    setShowSections(loaded.showSections===true);
    if(loaded.renderRange){setRenderMode('range');setRangeStart(String(loaded.renderRange.startFrame/FPS));setRangeEnd(String(loaded.renderRange.endFrame/FPS));}
    else {setRenderMode('all');setRangeStart('0');setRangeEnd(null);}
    restoredView.current=snapshot.record.view;
    // The layout effect only re-fits on a duration change, and a lyrics-only
    // session (or a clip of the same length) does not change it: bump the
    // effect so the saved zoom is applied now instead of on the next fit.
    setSessionApplied(applied=>applied+1);
    for (const kind of ['audio','video'] as const) {
      const entry=snapshot.media[kind];
      if(!entry || !Number.isFinite(entry.seconds) || entry.seconds<1/FPS)continue;
      setLocalMedia(kind,{file:new File([entry.blob],entry.name),src:URL.createObjectURL(entry.blob),seconds:entry.seconds});
    }
    resetPlayhead();setFollowing(true);
  });

  const persistSession=useEffectEvent(async ({withMedia=false}:{withMedia?:boolean})=>{
    const db=sessionDb.current;
    if(!db || sessionRestoring.current)return;
    const {audio,video}=mediaState.current;
    try {
      // The preview drops markers past the current duration; the session must
      // keep every section the user placed, exactly like the .json file does.
      const record=buildSessionRecord({project:{...project,sections},cues,length,renderRange,media:{audio:audio?.file.name ?? null,video:video?.file.name ?? null},view,savedAt:Date.now()});
      const outcome=await saveSession(db,{record,media:withMedia?{audio:audio?{name:audio.file.name,seconds:audio.seconds,blob:audio.file}:null,video:video?{name:video.file.name,seconds:video.seconds,blob:video.file}:null}:undefined});
      setSessionSavedAt(outcome.record.savedAt);
      setSessionQuota(outcome.quotaExceeded);
    } catch {
      // A failed autosave must never interrupt editing: the last good session stays.
    }
  });

  function restartSession() {
    const db=sessionDb.current;
    if(db)void clearSession(db).catch(()=>{});
    forgetJobId();
    sessionRestoring.current=true;
    setSessionSavedAt(null);setSessionQuota(false);
    edit({type:'reset',cues:demoCues});
    setDraft(sample);setWide(false);setEffect(PRESETS.classic);setSections([]);setShowSections(false);
    setRenderMode('all');setRangeStart('0');setRangeEnd(null);
    removeMedia('audio');removeMedia('video');
    restoredView.current=null;
    timelineFitted.current=true;
    setView(createView(DEMO_SECONDS,trackWidth()));
    sessionRestoring.current=false;
    setError('');setNotice('Đã bắt đầu lại với project mẫu.');
  }

  const tapFromKeyboard = useEffectEvent((e: KeyboardEvent) => {
    if (inspectorTab!=='sync') return;
    const space=e.code==='Space';
    if (e.defaultPrevented || e.isComposing || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (!space && e.key.toLowerCase()!=='t')) return;
    if (e.target instanceof HTMLElement) {
      const target=e.target;
      if (target.isContentEditable || target.closest('input, textarea, select, [role=tablist]')) return;
      if (target!==document.body && !target.closest('.sync-tab, .transport, .lyric-track')) return;
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
    const el=timelineViewport.current;
    const rect=el?.getBoundingClientRect();
    const pointed=el && rect && e.clientX>=rect.left && e.clientX<=rect.right && e.clientY>=rect.top && e.clientY<=rect.bottom;
    zoomTimeline(e.deltaY < 0 ? 1.2 : 1 / 1.2, pointed ? xToTime(el.scrollLeft+e.clientX-rect.left,view) : time);
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

  useEffect(()=>{
    // Restore before anything can be written, so a reload never overwrites the
    // session it has not read yet.
    let cancelled=false;
    void (async()=>{
      try {
        const db=await openStudioDb();
        if(cancelled)return;
        sessionDb.current=db;
        sessionRestoring.current=true;
        const snapshot=await loadSession(db);
        if(snapshot && !cancelled)applySession(snapshot);
        sessionRestoring.current=false;
        setSessionSavedAt(snapshot?.record.savedAt ?? null);
        const jobId=readJobId();
        if(jobId && !cancelled)void resumeRenderJob(jobId);
      } catch {
        sessionRestoring.current=false;
        if(!cancelled)setError('Không đọc được project đã lưu trong trình duyệt.');
      }
    })();
    return ()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current=window.setTimeout(()=>void persistSession({}),500);
    return ()=>window.clearTimeout(autosaveTimer.current);
  },[cues,effect,sections,showSections,wide,renderMode,rangeStart,rangeEnd,length]);
  useEffect(()=>{
    // Zoom and scroll are not worth a write per drag, but they should not be lost
    // when the tab is closed or hidden.
    const flush=()=>void persistSession({});
    const onVisibility=()=>{if(document.visibilityState==='hidden')flush();};
    window.addEventListener('pagehide',flush);
    document.addEventListener('visibilitychange',onVisibility);
    return ()=>{window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',onVisibility);};
  },[]);

  return <div className="studio">
    <header className="topbar">
      <div className="identity"><span className="mark" aria-hidden="true">R</span><div><h1>Remain Studio</h1><span>VIDEO CHỮ CHUYỂN ĐỘNG</span></div></div>
      <div className="toolbar"><label>Khung hình<select value={wide?'wide':'tall'} onChange={e=>setWide(e.target.value==='wide')}><option value="tall">9:16 · Dọc</option><option value="wide">16:9 · Ngang</option></select></label>
      <Button type="button" className="px-3 font-semibold min-[781px]:px-4" disabled={busy || Boolean(rangeError) || (!visibleCues.length && !audio && !video)} onClick={exportClip}>{busy?(renderJob?`Đang render… ${Math.round(renderJob.progress*100)}%`:'Đang render…'):'Xuất MP4'}</Button>{busy && <Button type="button" variant="outline" className="px-3 min-h-[44px] min-[781px]:px-4" onClick={cancelRender}>Huỷ render</Button>}</div>
    </header>
    <main className="workspace">
      <section className="viewer min-[781px]:self-start" aria-label="Preview">
        <div className="section-bar"><h2>Preview</h2><span className="badge">Aurora</span></div>
        <div className={'stage '+(wide?'wide':'tall')}>
          <Player ref={player} component={Scene} inputProps={inputProps} fps={FPS} durationInFrames={length} compositionWidth={project.width} compositionHeight={project.height} style={{width:'100%',aspectRatio:`${project.width} / ${project.height}`}} controls={false} spaceKeyToPlayOrPause={false} acknowledgeRemotionLicense />
        </div>
        <div className="transport"><Button type="button" variant="outline" size="icon" onClick={()=>seek(0)} title="Về đầu clip" aria-label="Về đầu clip">⏮</Button><Button type="button" variant="outline" className="play-toggle" onClick={togglePlayback}>{playing?'Tạm dừng':'Phát'}</Button><output>{seconds(time)} <span>/ {seconds(duration)}</span></output></div>
      </section>
      <aside className="inspector" aria-label="Nội dung project">
        <Tabs value={inspectorTab} onValueChange={setInspectorTab} activationMode="manual" className="inspector-tabs">
          <TabsList aria-label="Công cụ chỉnh sửa">
            <TabsTrigger value="sync">Canh từ</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="lyrics">Lời</TabsTrigger>
            <TabsTrigger value="effects">Hiệu ứng</TabsTrigger>
            <TabsTrigger value="project">Project</TabsTrigger>
          </TabsList>
          <TabsContent value="sync" className="sync-tab" forceMount>
        <LyricSyncPanel panelRef={tapPanel} cues={cues} line={line} selectedWord={following?null:selection?.[1] ?? null}
          liveLine={liveLine} liveWord={liveWord} time={time} playing={playing} following={following}
          complete={!following && selection===null} canTap={canTap} targetText={targetWord?.text} canReplay={canReplay} onReplay={replayLine} onFollow={()=>setFollowing(true)}
          onMarkMode={enterMarkMode} onLine={pickLine} onWord={lockWord} onLineStart={editLineStart} onTap={tap}/>
          </TabsContent>
          <TabsContent value="media" forceMount>
        <section className="panel"><div className="section-bar"><h2>Media</h2><span className="subtle">Nhạc 25 MiB · Video 100 MiB</span></div>
          <label htmlFor="audio-file">Chọn nhạc từ máy</label><Input id="audio-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseMedia('audio',file);}}/>
          {audio && <div className="flex min-w-0 items-center justify-between gap-2.5"><span className="filename">{audio.file.name}</span><Button type="button" variant="outline" size="sm" onClick={()=>removeMedia('audio')}>Gỡ nhạc</Button></div>}
          <label htmlFor="video-file">Chọn video nền</label><Input id="video-file" type="file" accept="video/*,.mp4,.mov,.webm,.mkv" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseMedia('video',file);}}/>
          {video && <div className="flex min-w-0 items-center justify-between gap-2.5"><span className="filename">{video.file.name}</span><Button type="button" variant="outline" size="sm" onClick={()=>removeMedia('video')}>Gỡ video</Button></div>}
          {video && <p className="hint">{audio?'Nhạc riêng thay âm thanh gốc của video.':'Đang dùng âm thanh gốc của video.'}</p>}
        </section>
          </TabsContent>
          <TabsContent value="lyrics" forceMount>
        <section className="panel"><div className="section-bar"><h2>Lời</h2><label className="filebutton">Nhập .LRC<input type="file" accept=".lrc,text/plain" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void chooseLrc(file);}}/></label></div>
          <form onSubmit={applyLyrics}><label htmlFor="lyrics">Dán lời, mỗi câu một dòng, hoặc dán LRC</label><Textarea id="lyrics" className="field-sizing-fixed" rows={5} maxLength={16000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" variant="outline">Áp dụng lời</Button></form>
        </section>
          </TabsContent>
          <TabsContent value="effects" forceMount>
        <EffectsPanel effect={effect} lineLabel={cue?`Dòng ${line+1}: ${cue.text}`:undefined} lineEffect={cue?.effect}
          onChange={editEffect} onResetLine={resetLineEffect} emphasisWord={emphasisWord?.text} emphasized={emphasisWord?.emphasis===true} onEmphasis={toggleEmphasis}
          sections={sections} showSections={showSections} onShowSections={setShowSections} time={time} onAddSection={addSection}
          onRemoveSection={start=>setSections(previous=>previous.filter(s=>s.start!==start))} onSeekSection={start=>seek(start*FPS)}/>
          </TabsContent>
          <TabsContent value="project" forceMount>
        <section className="panel"><div className="section-bar"><h2>Project</h2><span className="subtle">{sessionSavedAt?`đã tự lưu lúc ${new Date(sessionSavedAt).toLocaleTimeString('vi-VN')}`:'chưa tự lưu'}</span></div>
          <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" onClick={saveProject}>Lưu project</Button><label className="filebutton">Nạp project<input id="project-file" type="file" accept=".json,application/json" onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void loadProject(file);}}/></label><Button type="button" variant="outline" onClick={restartSession}>Bắt đầu lại</Button></div>
          <p className="hint">Studio tự lưu lời, mốc từ, khổ khung, phạm vi xuất, zoom cùng nhạc và video trong trình duyệt. Reload trang không mất project.</p>
          <p className="hint">File .json để dành hoặc chuyển máy; nó không chứa nhạc và video.</p>
          {sessionQuota && <p className="error" role="status">{QUOTA_NOTICE}</p>}
        </section>
          </TabsContent>
        </Tabs>
      </aside>
      <section className="timeline" ref={timelineSection} aria-label="Timeline">
      <div className="section-bar"><h2>Timeline</h2><div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={!canUndo(editor)} onClick={undo} title="Hoàn tác (Ctrl+Z)">Hoàn tác</Button>
        <Button type="button" variant="outline" size="sm" disabled={!canRedo(editor)} onClick={redo} title="Làm lại (Ctrl+Shift+Z)">Làm lại</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>zoomTimeline(1/1.4)} aria-label="Thu nhỏ timeline" title="Thu nhỏ (-)">−</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>zoomTimeline(1.4)} aria-label="Phóng to timeline" title="Phóng to (+)">+</Button>
        <Button type="button" variant="outline" size="sm" onClick={()=>fitTimeline()} title="Vừa khung (F)">Vừa khung</Button>
        <span className="subtle">{seconds(time)} / {seconds(duration)} · {FPS} fps</span></div></div>
      <TimelineTracks viewport={timelineViewport} viewportWidth={timelineWidth} view={view} length={length} frame={frame}
        cues={visibleCues} liveLine={liveLine} selectedLine={!following && selection ? line : null}
        video={video && {name:video.file.name,seconds:(videoLength ?? 0)/FPS}} audio={audio && {name:audio.file.name,seconds:audio.seconds}}
        onScroll={scrollTimeline} onSeek={seek} onPickCue={pickTimelineCue}/>
      </section>
    </main>
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
      <label className="flex min-h-[44px] items-center gap-2 text-sm"><input className="size-4" type="checkbox" checked={gpuExport} onChange={e=>setGpuExport(e.target.checked)}/><span>Vẽ khung hình bằng iGPU</span><span className="opacity-70">Nhanh hơn trên card tích hợp; chữ có thể khác nhẹ về antialias.</span></label>
      {rangeError && <p className="error" role="status">{rangeError}</p>}
    </section>
    <footer><span>Render bằng máy đang chạy Studio · MP4 / H.264</span><div role={error?'alert':'status'} className={error?'error':''}>{error || (busy?'Đang render trên máy. Render vẫn chạy nếu bạn reload trang.':notice)}</div></footer>
  </div>;
}