import {useEffect,useMemo,useState} from 'react';
import {visibleWaveform,waveformEnvelope,waveformWindow,type WaveEnvelope} from '../waveform.mjs';
import type {View} from '../editor.mjs';

const SAMPLES_PER_TILE = 48;
const SAMPLE_MS = 70;
type AudioSource = {src:string;seconds:number};
type Analysis = {src:string;start:number;end:number;peaks:number[];envelope:WaveEnvelope|null};

// Use the browser's media decoder as a stream: never request an entire decoded
// AudioBuffer. Short visible tiles expose genuine 20Hz samples; larger tiles
// fall back to at most 48 coarse visual probes rather than playing hours of audio.
async function sampleTile(src:string, start:number, end:number, signal:AbortSignal):Promise<{peaks:number[];envelope:WaveEnvelope|null}> {
  const element = new Audio();
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  const silence = context.createGain();
  silence.gain.value = 0;
  analyser.fftSize = 2048;
  const source = context.createMediaElementSource(element);
  source.connect(analyser);
  analyser.connect(silence);
  silence.connect(context.destination);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    element.pause();
    element.removeAttribute('src');
    element.load();
    source.disconnect();
    analyser.disconnect();
    silence.disconnect();
    void context.close().catch(() => {});
  };
  // Abort disposes the decoder immediately even while play() or seek is pending.
  signal.addEventListener('abort', release, {once:true});
  const bytes = new Uint8Array(analyser.fftSize);
  const peak=()=>{
    analyser.getByteTimeDomainData(bytes);
    let amplitude=0;
    for (const value of bytes) amplitude=Math.max(amplitude,Math.abs(value-128)/128);
    return amplitude;
  };
  const sleep = (ms:number) => new Promise<void>(resolve => {
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, {once:true});
  });
  const waitSeek = () => new Promise<void>((resolve,reject) => {
    const timer = setTimeout(() => finish(Error('Audio seek timed out')), 2500);
    const seeked = () => finish();
    const failed = () => finish(Error('Audio seek failed'));
    const abort = () => finish(Error('Cancelled'));
    function finish(error?:Error) {
      clearTimeout(timer);
      element.removeEventListener('seeked',seeked);
      element.removeEventListener('error',failed);
      signal.removeEventListener('abort',abort);
      if (error) reject(error); else resolve();
    }
    element.addEventListener('seeked',seeked,{once:true});
    element.addEventListener('error',failed,{once:true});
    signal.addEventListener('abort',abort,{once:true});
  });
  try {
    element.preload = 'auto';
    element.muted = false;
    element.src = src;
    // Audio goes through a zero-gain output so analysis does not make sound.
    await element.play();
    await context.resume();
    element.pause();
    if (end-start <= 8) {
      if (start > 0) {
        const seek=waitSeek();
        element.currentTime=start;
        await seek;
      }
      const count=Math.floor((end-start)/0.05);
      const peaks:number[]=[];
      const deadline=performance.now()+Math.max(3000,(end-start)*3000);
      await element.play();
      for (let index=0; index<count && !signal.aborted; index++) {
        const target=start+(index+0.5)*0.05;
        while (element.currentTime<target && !signal.aborted) {
          if (performance.now()>deadline) throw Error('Audio analysis timed out');
          await sleep(10);
        }
        if (!signal.aborted) peaks.push(peak());
      }
      return {peaks,envelope:waveformEnvelope(peaks,start)};
    }
    const count = Math.min(SAMPLES_PER_TILE, Math.max(1, Math.ceil((end-start)*12)));
    const peaks:number[] = [];
    for (let index=0; index<count && !signal.aborted; index++) {
      const position = start + (index + 0.5) * (end-start) / count;
      const seek = waitSeek();
      element.currentTime = position;
      await seek;
      if (signal.aborted) break;
      await element.play();
      await sleep(SAMPLE_MS);
      peaks.push(peak());
      element.pause();
    }
    return {peaks,envelope:null};
  } finally {
    signal.removeEventListener('abort', release);
    release();
  }
}

export function useWaveform(audio:AudioSource|null,view:View,viewportWidth:number) {
  const [analysis,setAnalysis]=useState<Analysis|null>(null);
  const window=audio && waveformWindow(view,viewportWidth,audio.seconds);
  const tile = window ? Math.floor(view.scrollX / viewportWidth) : -1;
  const start = audio && tile >= 0 ? tile * viewportWidth / view.pxPerSec : 0;
  const end = audio ? Math.min(audio.seconds,start + viewportWidth / view.pxPerSec) : 0;
  const src = audio?.src;
  useEffect(()=>{
    if (!src || end <= start) {setAnalysis(null);return;}
    const controller=new AbortController();
    setAnalysis(null);
    void sampleTile(src,start,end,controller.signal).then(({peaks,envelope})=>{
      if (!controller.signal.aborted && peaks.length) setAnalysis({src,start,end,peaks,envelope});
    }).catch(()=>{ /* Unsupported codec / seek / autoplay: keep a plain media clip. */ });
    return ()=>controller.abort();
  },[src,start,end]);
  return useMemo(()=>analysis && analysis.src===src && analysis.start===start && analysis.end===end
    ? {bars:visibleWaveform(analysis.peaks,{start,end},view,viewportWidth),envelope:analysis.envelope}
    : {bars:[],envelope:null},[analysis,src,start,end,view,viewportWidth]);
}
