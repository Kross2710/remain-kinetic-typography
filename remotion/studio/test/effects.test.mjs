import test from 'node:test';
import assert from 'node:assert/strict';
import {importLyrics,setCueStart,validateProject} from '../project.mjs';
import {parseProjectFile,serializeProject} from '../editor.mjs';

const aurora={preset:'aurora',font:'serif',size:1.1,color:'#ece3d4',accent:'#f0b15c',entry:.6,stagger:.04};
const classic={...aurora,preset:'classic'};
const sections=[{start:0,kind:'verse'},{start:3,kind:'chorus'}];
const original={width:720,height:1280,durationInFrames:180,cues:importLyrics('Một hai\nBa bốn',6)};

test('round trips project, line and word styling without touching timings',()=>{
 const cues=original.cues.map((cue,i)=>i ? {...cue,effect:classic,words:cue.words.map((w,j)=>j?w:{...w,emphasis:true})}:cue);
 const project={...original,cues,effect:aurora,sections,showSections:true};
 const loaded=parseProjectFile(serializeProject({project}));
 assert.deepEqual(loaded.effect,aurora);
 assert.deepEqual(loaded.cues,cues);
 assert.deepEqual(loaded.sections,sections);
 assert.equal(loaded.showSections,true);
 assert.equal(setCueStart(cues,1,3.5,6)[1].words[0].emphasis,true);
 assert.equal(parseProjectFile(serializeProject({project:original})).effect,undefined);
});

test('rejects unknown render styles and invalid section data',()=>{
 for(const effect of [{...aurora,font:'url(remote)'},{...aurora,color:'red'},{...aurora,entry:99},{...aurora,preset:'custom'}]) assert.throws(()=>validateProject({...original,effect}));
 for(const bad of [[{start:-1,kind:'verse'}],[{start:1,kind:'BOGUS'}],[...sections,{start:2,kind:'bridge'}]]) assert.throws(()=>validateProject({...original,sections:bad}));
});
