import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS, validateEffect, validateMotion, resolveMotion} from '../effects.mjs';
import {karaokeFill,webEntry,wordRise,inkFrame,webFlowOffset,webFlowPast} from '../shared-motion.mjs';
import {parseProjectFile,serializeProject} from '../editor.mjs';

const make=(preset,motion)=>({...PRESETS[preset],motion});

test('shared motion inherits across presets, with explicit per-cue off and project-only flow',()=>{
  const base=make('classic',{enter:true,wipe:true,flow:true});
  const local={wipe:false,ink:true};
  assert.deepEqual(resolveMotion(base,local),{enter:true,wipe:false,ink:true,flow:true});
  assert.deepEqual(resolveMotion(make('whisper',base.motion),{wipe:true}),{enter:true,wipe:true,ink:false,flow:true});
});

test('motion settings survive project JSON and API validation without changing legacy effect data',()=>{
  const base=make('aurora',{enter:true,wipe:true,flow:true});
  const local={wipe:false,ink:true};
  const p={width:720,height:1280,durationInFrames:60,effect:base,cues:[{text:'Lời hát',start:0,words:[{text:'Lời',start:0},{text:'hát',start:1}],effect:PRESETS.classic,motion:local}]};
  const decoded=parseProjectFile(serializeProject({project:p}));
  assert.deepEqual(decoded.effect,base);
  assert.deepEqual(decoded.cues[0].motion,local);
  assert.deepEqual(decoded.cues[0].effect,PRESETS.classic);
  assert.deepEqual(validateEffect(PRESETS.classic),PRESETS.classic);
});

test('rejects unknown motion ids, non-booleans, per-line flow',()=>{
  assert.throws(()=>validateEffect(make('classic',{wipe:'true'})),/chuyển động/i);
  assert.throws(()=>validateEffect(make('classic',{custom:true})),/chuyển động/i);
  assert.throws(()=>validateMotion({flow:true},'line'),/project/i);
  const web=make('web-match',{wipe:true});
  assert.deepEqual(validateEffect(web),web,'Saved settings can survive a trip through Web Match');
  assert.deepEqual(resolveMotion(web,{ink:true}),{enter:false,wipe:false,ink:false,flow:false});
});




test('karaoke advances through the current glyph over the cut-off word duration',()=>{
  const fill=karaokeFill;
  assert.equal(fill(9,10,30,4,0),0);
  assert.ok(Math.abs(fill(10.1,10,30,4,0)-.5)<1e-10);
  assert.equal(fill(10.1,10,30,4,1),0);
  assert.equal(fill(10.8,10,30,4,3),1);
});

test('Web entry and ink are bounded and retain the held reveal delay',()=>{
  assert.deepEqual(webEntry(0),{opacity:0,lift:14,zoom:.99,blur:10});
  assert.deepEqual(webEntry(12),{opacity:1,lift:0,zoom:1.04,blur:0});
  assert.equal(wordRise(0,0),110);
  assert.equal(wordRise(1.1,0),0);
  assert.equal(inkFrame(.1,.05,3).opacity,.04);
  assert.equal(inkFrame(2,.05,3).opacity,1);
});

test('Web flow eases from the reached position when the next cue interrupts it',()=>{
  const scroll=webFlowOffset;
  assert.equal(scroll([0,1],[100,200],1),-100);
  const during=scroll([0,1],[100,200],1.3);
  assert.ok(during< -100 && during> -200);
  assert.equal(scroll([0,1,1.3],[100,200,300],1.3),during);
  assert.equal(scroll([0,1,1.3],[100,200,300],8),-300);
});


test('Outgoing lines preserve fade and blur through closely spaced cue boundaries',()=>{
  const fading=webFlowPast([1],1.22);
  assert.ok(fading.opacity<1 && fading.opacity>.62);
  assert.deepEqual(webFlowPast([1,1.22],1.22),fading);
  const settled=webFlowPast([1,1.22],12);
  assert.equal(settled.opacity,.47);
  assert.equal(settled.zoom,.9);
});
