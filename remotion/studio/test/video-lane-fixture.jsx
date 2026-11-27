import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TimelineTracks} from '../components/TimelineTracks';
import {moveClip,muteClip,removeClip,splitClip,trimClip} from '../video-track.mjs';
import '../studio.css';

const first={id:'a',mediaId:'media-a',name:'Alfa.mp4',sourceFrames:100,inFrame:10,outFrame:70,muted:false};
const second={id:'b',mediaId:'media-b',name:'Bravo.mp4',sourceFrames:100,inFrame:0,outFrame:30,muted:false};
const third={id:'c',mediaId:'media-c',name:'Charlie.mp4',sourceFrames:100,inFrame:10,outFrame:40,muted:false};
window.calls=[];
function Fixture(){
  const viewport=useRef(null);
  const [scrollX,setScrollX]=useState(0);
  const [frame,setFrame]=useState(30);
  const [clips,setClips]=useState(()=>[location.search.includes('tiny')?{...first,outFrame:11}:first,second,third]);
  const [missing,setMissing]=useState(()=>new Set(['media-b']));
  const commit=(type,edit)=>(...args)=>{window.calls.push([type,...args]);setClips(old=>edit(old,...args));};
  return <section className="timeline" style={{maxWidth:440}}>
    <TimelineTracks viewport={viewport} viewportWidth={332} view={{pxPerSec:120,scrollX}}
      length={300} frame={frame} cues={[]} allCues={[]} liveLine={-1} selectedLine={null} snapEnabled={false}
      video={{name:'Legacy.mp4',seconds:3}} audio={null} onScroll={setScrollX} onSeek={f=>setFrame(Math.round(f))}
      onPickCue={()=>{}} onCommit={()=>{}}
      videoEdits={location.search.includes('legacy')?undefined:{clips,missing,
        onMove:commit('move',moveClip),onTrim:commit('trim',trimClip),
        onSplit:commit('split',(track,id,f)=>splitClip(track,id,f,`${id}-split`)),onDelete:commit('delete',removeClip),
        onMute:commit('mute',muteClip),onRelink:(id,file)=>{
          window.calls.push(['relink',id,file.name,file.size]);
          setMissing(old=>new Set([...old].filter(mediaId=>mediaId!==id)));
        }}}/>
  </section>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
