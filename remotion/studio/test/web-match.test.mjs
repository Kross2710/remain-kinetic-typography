import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {publicPlayerAsset,webMatchAssets} from '../update-web-match-assets.mjs';
import assert from 'node:assert/strict';
import {PRESETS, PRESET_LABELS, validateEffect} from '../effects.mjs';
import {parseProjectFile, serializeProject} from '../editor.mjs';

test('Web Match is an opt-in preset that survives save/load and render validation',()=>{
  assert.equal(PRESETS['web-match']?.preset,'web-match');
  assert.equal(PRESET_LABELS['web-match'],'Web Match');
  const project={width:1280,height:720,durationInFrames:300,cues:[],effect:PRESETS['web-match']};
  assert.deepEqual(parseProjectFile(serializeProject({project})).effect,validateEffect(PRESETS['web-match']));
});


test('Web Match cannot be assigned to an individual line',()=>{
  const project={width:1280,height:720,durationInFrames:300,cues:[{text:'Hello',start:0,words:[{text:'Hello',start:0}],effect:PRESETS['web-match']}]};
  assert.throws(()=>serializeProject({project}),/toàn bộ project/);
});

test('packaged Web Match assets are byte-for-byte copies of the public player',async()=>{
  assert.deepEqual(JSON.parse(await readFile(publicPlayerAsset,'utf8')),await webMatchAssets(),
    'Run node studio/update-web-match-assets.mjs after changing the public player.');
});
