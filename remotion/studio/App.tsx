import {useEffect,useEffectEvent,useMemo,useRef,useState,type FormEvent,type MouseEvent as ReactMouseEvent} from 'react';
import {Player,type PlayerRef} from '@remotion/player';
import {Scene} from './Scene';
import {activeAt,clipCues,DEMO_SECONDS,FPS,importLyrics,MAX_AUDIO_BYTES,MAX_SECONDS,MAX_VIDEO_BYTES,rangeFromSeconds,setCueStart,setWordStart,timelineLength,validateProject,type RenderRange} from './project.mjs';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';

const sample='[00:00.00]Một nhịp thở\n[00:05.00]Rồi chữ bắt đầu chuyển động\n[00:12.00]Mỗi từ theo một nhịp\n[00:22.00]Đến lượt bạn kể chuyện';
const seconds=(n:number)=>n.toFixed(2)+'s';
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
type MediaKind='audio'|'video';
type LocalMedia={file:File;src:string;seconds:number};

export default function Studio() {
  const player=useRef<PlayerRef>(null);
  const tapPanel=useRef<HTMLElement>(null);
  const uploadSeq=useRef({audio:0,video:0});
  const mediaUrls=useRef<Partial<Record<MediaKind,string>>>({});
  const [audio,setAudio]=useState<LocalMedia|null>(null);
  const [video,setVideo]=useState<LocalMedia|null>(null);
  const [wide,setWide]=useState(false);
  const [draft,setDraft]=useState(sample);
  const [cues,setCues]=useState(()=>importLyrics(sample,DEMO_SECONDS));
  const [selection,select]=useState<[number,number]>([0,0]);
  const [frame,setFrame]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [renderMode,setRenderMode]=useState<'all'|'range'>('all');
  const [rangeStart,setRangeStart]=useState('0');
  const [rangeEnd,setRangeEnd]=useState<string|null>(null);
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
  const [line,word]=selection;
  const [liveLine]=activeAt(visibleCues,time);
  const cue=cues[line];

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
    try {setCues(text.trim()?importLyrics(text,duration,MAX_SECONDS):[]);select([0,0]);setError('');setNotice('Đã cập nhật lời.');}
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
  function tap() {
    if (!cue) return;
    try {
      setCues(setWordStart(cues,line,word,(player.current?.getCurrentFrame() ?? frame)/FPS,duration));
      if(word+1<cue.words.length)select([line,word+1]);
      else if(line+1<cues.length)select([line+1,0]);
      setError('');
    } catch(e){setError(errText(e));}
  }
  async function exportClip() {
    setError('');setNotice('');setBusy(true);
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
    finally {setBusy(false);}
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
    if (!cue) return;
    e.preventDefault();
    tap();
  });
  useEffect(() => {
    // The focused word button may disappear when the next line is shorter.
    const onKeyDown = (e: KeyboardEvent) => tapFromKeyboard(e);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div className="studio">
    <header className="topbar">
      <div className="identity"><span className="mark" aria-hidden="true">R</span><div><h1>Remain Studio</h1><span>VIDEO CHỮ CHUYỂN ĐỘNG</span></div></div>
      <div className="toolbar"><label>Khung hình<select value={wide?'wide':'tall'} onChange={e=>setWide(e.target.value==='wide')}><option value="tall">9:16 · Dọc</option><option value="wide">16:9 · Ngang</option></select></label>
      <Button type="button" className="px-3 font-semibold min-[781px]:px-4" disabled={busy || Boolean(rangeError) || (!visibleCues.length && !audio && !video)} onClick={exportClip}>{busy?'Đang render…':'Xuất MP4'}</Button></div>
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
        <section className="panel" ref={tapPanel} tabIndex={-1} aria-labelledby="tap-panel-title"><div className="section-bar"><h2 id="tap-panel-title">03 · Canh từng từ</h2><span className="subtle">{cue?`${line+1} / ${cues.length}`:'0 / 0'}</span></div>
          {cue && <><label htmlFor="cue-picker">Dòng đang sửa</label><select id="cue-picker" value={line} onChange={e=>{const i=Number(e.target.value);select([i,0]);seek((cues[i].start-0.3)*FPS);}}>{cues.map((c,i)=><option key={i} value={i}>{i+1}. {c.text}</option>)}</select>
          <label className="cue-start-field flex items-center justify-between gap-2">Mốc đầu dòng (giây)<Input className="w-[90px]" key={`${line}:${cue.start}`} type="number" min="0" max={MAX_SECONDS} step="0.01" defaultValue={cue.start} onBlur={e=>{
            const value=e.currentTarget.valueAsNumber;if(value===cue.start)return;
            try{setCues(setCueStart(cues,line,value,value>=duration || cue.start>=duration ? MAX_SECONDS : duration));setError('');seek(value*FPS);}
            catch(err){e.currentTarget.value=String(cue.start);setError(errText(err));}
          }}/></label>
          <div className="words">{cue.words.map((w,i)=><Button type="button" key={i} size="sm" variant="outline" className="gap-1 px-2 aria-pressed:border-primary aria-pressed:bg-[#483120] aria-pressed:text-[#ffd89d]" aria-pressed={i===word} onClick={()=>select([line,i])}>{w.text} <small>{seconds(w.start)}</small></Button>)}</div>
          <Button type="button" className="tap" variant="outline" aria-keyshortcuts="Space T" onClick={tap}>Đóng dấu từ</Button><p className="hint">Bấm Space hoặc T theo nhạc. Từ đầu tiên sẽ đặt lại mốc dòng.</p></>}
        </section>
      </aside>
    </main>
    <section className="timeline" aria-label="Timeline">
      <div className="section-bar"><h2>Timeline</h2><span className="subtle">{seconds(time)} / {seconds(duration)} · {FPS} fps</span></div>
      <div className="lane"><span>Playhead</span><input id="timeline" aria-label="Vị trí timeline" type="range" min={0} max={length-1} step={1} value={frame} onChange={e=>seek(Number(e.target.value))}/></div>
      <div className="lane"><span>Video</span><div className="track video-track">{video && <span style={{width:`${100*(videoLength ?? 0)/length}%`}}>{video.file.name}</span>}</div></div>
      <div className="lane"><span>Nhạc</span><div className={'audio-lane '+(audio?'loaded':'')}>{audio?audio.file.name:'Chưa có nhạc'}</div></div>
      <div className="lane"><span>Lời</span><div className="track">{visibleCues.map((c,i)=><button key={i} className={i===liveLine?'live':''} title={`${c.text} · ${seconds(c.start)}`} aria-label={`Tua đến dòng ${i+1}: ${c.text}`} onClick={()=>{select([i,0]);seek(Math.ceil(c.start*FPS));}} style={{left:`${100*c.start/duration}%`,width:`${100*((visibleCues[i+1]?.start??duration)-c.start)/duration}%`}}>{c.text}</button>)}</div></div>
    </section>
    <section className="export-options" aria-label="Thiết lập xuất video">
      <div className="section-bar"><h2>Thiết lập xuất</h2><output id="render-duration">{rangeError?'—':seconds((renderRange?renderRange.endFrame-renderRange.startFrame:length)/FPS)}</output></div>
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
