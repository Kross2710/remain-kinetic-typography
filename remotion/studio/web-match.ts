import type {Project} from './project.mjs';
import {SECTION_LABELS,type SectionKind} from './effects.mjs';

type WebAssets=Record<'css'|'gsap'|'sections'|'aurora'|'clock'|'animations'|'timings'|'parser'|'lyrics'|'words'|'emphasis'|'app',string>;
const playerUrl=new URL('./assets/web-match/public-player.txt',import.meta.url).href;
let playerAssets:Promise<WebAssets>|undefined;
function loadPlayerAssets(){
  return playerAssets ??= fetch(playerUrl).then(response=>{
    if(!response.ok)throw Error('Không tải được dữ liệu Web Match.');
    return response.json() as Promise<WebAssets>;
  }).catch(error=>{playerAssets=undefined;throw error;});
}
const fonts={
  fraunces:new URL('./assets/web-match/fraunces.ttf',import.meta.url).href,
  instrument:new URL('./assets/web-match/instrumentserif.ttf',import.meta.url).href,
  hanken:new URL('./assets/web-match/hankengrotesk.ttf',import.meta.url).href,
};

// The same stylesheet and DOM contract as index.html. Keep CSS viewport units,
// global selectors and the GSAP ticker inside the child document. The HTML is
// static; project data never enters markup or a script string.
export async function webMatchDocument(){
  const url={...await loadPlayerAssets(),...fonts};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="${url.css}">
<style>
@font-face{font-family:Fraunces;src:url('${url.fraunces}') format('truetype');font-weight:100 900;font-display:block}
@font-face{font-family:'Instrument Serif';src:url('${url.instrument}') format('truetype');font-style:italic;font-display:block}
@font-face{font-family:'Hanken Grotesk';src:url('${url.hanken}') format('truetype');font-weight:100 900;font-display:block}
/* Frame-driven GSAP is shared with the web export. Disable remaining wall-clock
   CSS transitions; the Aurora animations are sampled via WAAPI instead. */
.aurora,.scrim,.line.is-active::before,.word,.progress,.chrome{transition:none!important}
body.exporting #progress-wrap,body.exporting .chrome{opacity:1}
#controls,#bgvideo{display:none!important}
</style></head><body>
<div id="bgvideo" hidden></div><div id="web-match-media"></div>
<div class="aurora"><div class="au au-a"></div><div class="au au-b"></div></div>
<div class="scrim"></div><div class="vignette"></div><div class="grain"></div>
<div class="progress-wrap" id="progress-wrap"><div class="progress" id="progress"></div></div>
<div class="chrome"><div class="eyebrow" id="eyebrow"></div><div class="timecode" id="timecode"></div></div>
<main class="stage" id="stage"><div class="flow" id="flow"></div></main>
<audio id="audio" preload="none"></audio>
<div class="controls" id="controls"><button id="playBtn"></button><button id="fsBtn"></button><div id="status"></div></div>
${[url.gsap,url.sections,url.aurora,url.clock,url.animations,url.timings,url.parser,url.lyrics,url.words,url.emphasis].map(src=>`<script src="${src}"></script>`).join('')}
</body></html>`;
}

type WebWord={word:string;start:number;end:number};
type WebCue={text:string;time:number};
type WebSection={name:string;kind:string;end?:number};
type WebSite={
  parseLRC:(source:string)=>WebCue[];
  RAW_LRC:string;
  getWordTimings:(text:string,start:number,end:number)=>WebWord[];
  sectionAt:(time:number)=>WebSection;
  anim:{HOOK_RE:{test:(text:string)=>boolean}};
  PALETTE:Record<string,{au1:string;au2:string;accent:string}>;
  render:{begin:(options?:object)=>Promise<void>;step:(seconds:number)=>void};
};

// Find the first frame whose timestamp reaches the original (fractional) cue.
function firstFrame(start:number,fps:number){
  const n=Math.round(start*fps);
  return n/fps>=start?n:n+1;
}

export async function bootWebMatch(win:Window,project:Project,fps:number,hasVideo:boolean) {
  const doc=win.document;
  const kt=(win as Window & {KT?:WebSite}).KT;
  if(!kt?.anim||!kt.getWordTimings||!kt.sectionAt)throw Error('Không tải được player Web Match trong Studio.');
  const loadedFonts=await Promise.all([
    doc.fonts.load('300 48px Fraunces'),doc.fonts.load('italic 48px "Instrument Serif"'),doc.fonts.load('12px "Hanken Grotesk"'),
  ]);
  if(loadedFonts.some(font=>font.length===0))throw Error('Không tải được font Web Match.');

  const cues=project.cues.map(c=>({text:c.text,time:c.start}));
  // The original sheet ends with a non-editable blank cue. Restore it for
  // the matching song only; never add a synthetic outro to custom lyrics.
  const original=kt.parseLRC(kt.RAW_LRC);
  const outro=original.at(-1);
  const lastWord=project.cues.at(-1)?.words.at(-1);
  if(outro?.text==='' && lastWord && outro.time<project.durationInFrames/fps && lastWord.start<outro.time &&
    cues.length===original.length-1 && cues.every((cue,i)=>cue.time===original[i].time && cue.text===original[i].text)){
    cues.push(outro);
  }
  const byStart=new Map(project.cues.map((cue,i)=>[cue.start,{cue,end:cues[i+1]?.time ?? project.durationInFrames/fps}]));
  const matchesDefaultTiming=kt.getWordTimings;
  kt.parseLRC=()=>cues;
  kt.getWordTimings=(text,start,end)=>{
    const entry=byStart.get(start);
    if(!entry)return matchesDefaultTiming(text,start,end);
    const {cue,end:cueEnd}=entry;
    const original=matchesDefaultTiming(text,start,end);
    return original.length===cue.words.length && original.every((word,i)=>Math.abs(Math.max(word.start,start)-cue.words[i].start)<.000001)
      ? original
      : cue.words.map((word,i)=>({word:word.text,start:word.start,end:cue.words[i+1]?.start ?? cueEnd}));
  };
  const siteHook=kt.anim.HOOK_RE;
  let cueIndex=0;
  kt.anim.HOOK_RE={test:text=>project.cues[cueIndex++]?.hook===true || siteHook.test(text)};
  const markers=project.sections ?? [];
  if(markers.length){
    kt.PALETTE['pre-chorus']=kt.PALETTE.verse;
    kt.PALETTE.outro=kt.PALETTE.intro;
    const title=(kind:SectionKind)=>kind==='intro'?'':SECTION_LABELS[kind];
    kt.sectionAt=time=>{
      for(let i=markers.length-1;i>=0;i--){
        const {start,kind}=markers[i];
        if(time>=start)return {kind,name:title(kind)};
      }
      return {kind:'intro',name:''};
    };
  }
  // app.js owns layout, timing and GSAP. Remotion owns media, so give its
  // transport a no-op background sink; no duplicate decode or remote assets.
  const sink=doc.getElementById('bgvideo');
  if(!sink)throw Error('Web Match thiếu điểm gắn video.');
  Object.assign(sink,{readyState:2,currentTime:0,paused:true,play:()=>Promise.resolve(),pause:()=>{}});
  // The site resyncs from its own audio clock when the tab returns. In
  // Studio, that clock is idle; only the composition may change the pose.
  doc.addEventListener('visibilitychange',event=>event.stopImmediatePropagation(),{capture:true});
  const {app}=await loadPlayerAssets();
  await new Promise<void>((resolve,reject)=>{
    const script=doc.createElement('script');
    script.src=app;
    script.onload=()=>resolve();
    script.onerror=()=>reject(Error('Không tải được app.js của Web Match.'));
    doc.head.appendChild(script);
  });
  if(!kt.render)throw Error('Player Web Match không khởi tạo được.');
  await kt.render.begin();
  doc.body.classList.toggle('has-video',hasVideo);
  if(project.showSections){
    doc.querySelector<HTMLElement>('.chrome')?.style.removeProperty('display');
    doc.getElementById('progress-wrap')?.style.removeProperty('display');
  }

  const drifts=Array.from(doc.querySelectorAll('.au')).flatMap(layer=>layer.getAnimations());
  for(const drift of drifts)drift.pause();
  const switches=new Set<number>();
  for(const cue of cues)switches.add(firstFrame(cue.time,fps));
  for(const cue of project.cues){
    for(const word of cue.words)switches.add(firstFrame(word.start,fps));
  }
  let kind=kt.sectionAt(0).kind;
  for(let frame=1;frame<project.durationInFrames;frame++){
    const next=kt.sectionAt(frame/fps).kind;
    if(next!==kind){switches.add(frame);kind=next;}
  }
  const events=[...switches].filter(n=>n>0).sort((a,b)=>a-b);
  let frame=0,event=0;
  return {
    get frame(){return frame;},
    seek(target:number,videoVisible:boolean){
      doc.body.classList.toggle('has-video',videoVisible);
      while(event<events.length && events[event]<=target)kt.render.step(events[event++]/fps);
      if(target!==frame && events[event-1]!==target)kt.render.step(target/fps);
      for(const drift of drifts)drift.currentTime=videoVisible?0:target/fps*1000;
      frame=target;
      doc.documentElement.dataset.webMatchFrame=String(frame);
    },
  };
}
