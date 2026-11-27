import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectFile, serializeProject} from '../editor.mjs';
import {clipCues, validateProject} from '../project.mjs';
import {PRESETS, PRESET_LABELS, validateEffect} from '../effects.mjs';
import {whisperStack, whisperDrift, whisperGraphemes} from '../whisper.mjs';

test('Whisper is a selectable, validated preset without new persisted controls',()=>{
  assert.equal(PRESETS.whisper?.preset,'whisper');
  assert.equal(validateEffect(PRESETS.whisper).preset,'whisper');
  assert.ok(PRESET_LABELS.whisper.startsWith('Whisper'));
});

const fixture={width:720,height:1280,durationInFrames:120,cues:[
  {text:'Giữ lời',start:0,words:[{text:'Giữ',start:0},{text:'lời',start:.5}]},
  {text:'Ở lại',start:2,words:[{text:'Ở',start:2},{text:'lại',start:2.5}]},
]};

test('Hook is opt-in per cue and survives preview clipping and project reload',()=>{
  const input={...fixture,cues:[fixture.cues[0],{...fixture.cues[1],hook:true}]};
  const clean=validateProject(input);
  assert.equal(clean.cues[0].hook,undefined);
  assert.equal(clipCues(clean.cues,2.25)[1].hook,true);
  assert.equal(parseProjectFile(serializeProject({project:input})).cues[1].hook,true);
});

test('Hook rejects non-boolean values',()=>{
  const invalid={...fixture,cues:[{...fixture.cues[0],hook:'true'}]};
  assert.throws(()=>validateProject(invalid),/hook/i);
});

const timing=[{start:0},{start:1.01},{start:2.02},{start:3.02}];

test('Whisper carries the last visible frame into a stack capped at two prior cues',()=>{
  const stack=whisperStack(timing,3,91,30);
  assert.deepEqual(stack.map(layer=>[layer.index,layer.time]),[[1,60/30],[2,90/30]]);
  assert.deepEqual(stack[1].pose,{rise:0,scale:1,opacity:1,blur:0});
});

test('Whisper settles into separate depth levels and fades the oldest ahead of replacement',()=>{
  const settled=whisperStack(timing,2,80,30);
  assert.deepEqual(settled.map(layer=>layer.pose.opacity),[.12,.3]);
  const beforeHandoff=whisperStack(timing,2,90,30);
  assert.equal(beforeHandoff[0].pose.opacity,0);
  assert.equal(whisperStack(timing,0,1,30).length,0);
});

test('Whisper hold stays still until entry ends, drifts, and never leaves its bound',()=>{
  assert.equal(whisperDrift(.4,.5),0);
  assert.equal(whisperDrift(.5,.5),0);
  assert.ok(whisperDrift(3,.5)<0);
  assert.equal(whisperDrift(600,.5),-.16);
});


test('Hook splits graphemes without breaking decomposed Vietnamese or emoji',()=>{
  assert.deepEqual(whisperGraphemes('ố👩🏽‍🎤!'),['ố','👩🏽‍🎤','!']);
});
