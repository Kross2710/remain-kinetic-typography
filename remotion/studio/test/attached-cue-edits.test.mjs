import assert from 'node:assert/strict';
import test from 'node:test';
import {parseProjectFile, serializeProject} from '../editor.mjs';
import {activeSceneCues, attachCue} from '../lyric-attachment.mjs';
import {FPS, MAX_SECONDS, setCueStart, setWordStart, validateProject} from '../project.mjs';
import {moveCue, splitCue, trimCue} from '../timeline.mjs';
import {trimClip} from '../video-track.mjs';

const clip = {id:'scene',mediaId:'scene',name:'scene.mp4',sourceFrames:4*FPS,inFrame:0,outFrame:2*FPS,muted:false};
const extended = trimClip([clip], clip.id, 0, 4*FPS);
const line = (start, ...words) => ({text:words.map(([text])=>text).join(' '),start,words:words.map(([text,start])=>({text,start}))});
const attach = (cues, index=0) => attachCue(cues,index,[clip],clip.id,2);

function roundTrip(cues) {
  const project = {width:1280,height:720,durationInFrames:4*FPS,videoTrack:extended,cues};
  const clean = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(clean.cues, cues.map(cue=>({...cue,words:cue.words.map(({confirmed,...word})=>word)})));
  assert.deepEqual(parseProjectFile(serializeProject({project})).cues,cues);
}

test('move translates the attached source window after extending the video', () => {
  const original = attach([line(1,['One',1],['two',1.25])]);
  const moved = moveCue(original,0,2.5,4);
  roundTrip(moved);
  assert.deepEqual(moved[0].attachment,{end:3.5,segments:original[0].attachment.segments});
  assert.deepEqual(moved[0].words.map(w=>w.start),[2.5,2.75]);
  assert.equal(original[0].attachment.end,2);
  assert.deepEqual(activeSceneCues(moved,extended,75,FPS).map(({end})=>end),[3.5]);
  assert.deepEqual(activeSceneCues(moved,extended,105,FPS),[]);
  // The clip clips visibility; the source window need not fit inside it.
  const partiallyVisible = moveCue(original,0,3.5,4);
  assert.equal(partiallyVisible[0].attachment.end,4.5);
  roundTrip(partiallyVisible);
});

test('moving an attachment earlier keeps its first word at the requested fractional start', () => {
  const original = attach([line(1,['One',1],['two',1.25])]);
  const moved = moveCue(original,0,0.1,4);
  roundTrip(moved);
  assert.equal(moved[0].words[0].start,moved[0].start);
});

test('moving an attachment cannot push its trailing edge past the project maximum', () => {
  const original = attach([line(1,['One',1],['two',1.25])]);
  assert.throws(()=>moveCue(original,0,MAX_SECONDS-0.5,MAX_SECONDS),/gắn clip/);
});

test('setting an attached start fits estimated words before the fixed end', () => {
  const original = attach([line(1,['One',1],['two',1.25])]);
  const retimed = setCueStart(original,0,1.5,4);
  assert.deepEqual(retimed[0].words.map(w=>w.start),[1.5,1.75]);
  assert.strictEqual(retimed[0].attachment,original[0].attachment);
  roundTrip(retimed);
  assert.throws(()=>setCueStart(original,0,2.5,4),/Mốc dòng/);
});

test('word tapping keeps redistributed estimates inside the fixed window', () => {
  const original = attach([line(1,['One',1],['two',1.25])]);
  const retimed = setWordStart(original,0,0,1.5,4);
  assert.deepEqual(retimed[0].words.map(w=>w.start),[1.5,1.75]);
  assert.strictEqual(retimed[0].attachment,original[0].attachment);
  roundTrip(retimed);
  assert.throws(()=>setWordStart(original,0,0,2.5,4),/gắn clip/);
  assert.throws(()=>setWordStart(original,0,1,2,4),/gắn clip/);
});

test('word tapping cannot push a neighboring attachment past its fixed end', () => {
  const original = attach([line(0,['Before',0]),line(1,['One',1],['two',1.25])],1);
  assert.throws(()=>setWordStart(original,0,0,2.5,4),/gắn clip/);
  roundTrip(original);
});

test('splitting an attached lyric partitions its source window without overlap', () => {
  const original = attach([line(1,['One',1],['two',1.5])]);
  const split = splitCue(original,0,1);
  assert.deepEqual(split.map(cue=>cue.attachment.end),[1.5,2]);
  assert.deepEqual(split.map(cue=>cue.attachment.segments),[original[0].attachment.segments,original[0].attachment.segments]);
  assert.deepEqual(activeSceneCues(split,extended,44,FPS).map(({index})=>index),[0]);
  assert.deepEqual(activeSceneCues(split,extended,45,FPS).map(({index})=>index),[1]);
  roundTrip(split);
});

test('splitting at the exclusive edge of a previously saved attachment is rejected', () => {
  const original = attach([line(1,['One',1],['two',1.5])]);
  const stale = [{...original[0],words:[original[0].words[0],{text:'two',start:2}]}];
  assert.throws(()=>splitCue(stale,0,1),/gắn clip/);
});

test('trimming at the existing song boundary still shortens a moved attachment', () => {
  const original = attach([line(0,['Scene',0]),line(3,['Song',3])]);
  const moved = moveCue(original,0,1,4);
  assert.equal(moved[0].attachment.end,4);
  const trimmed = trimCue(moved,0,3,4);
  assert.equal(trimmed[0].attachment.end,3);
  assert.strictEqual(trimmed[1],moved[1]);
  assert.ok(activeSceneCues(trimmed,extended,89,FPS).some(({index})=>index===0));
  assert.ok(!activeSceneCues(trimmed,extended,90,FPS).some(({index})=>index===0));
  assert.strictEqual(trimCue(trimmed,0,3,4),trimmed);
  roundTrip(trimmed);
});

test('trimming moves the shared boundary between attached lines', () => {
  const original = attach(attach([line(0,['Before',0]),line(1,['One',1],['two',1.5])]),1);
  const trimmed = trimCue(original,0,1.25,4);
  assert.deepEqual(trimmed.map(cue=>[cue.start,cue.attachment.end]),[[0,1.25],[1.25,2]]);
  assert.strictEqual(trimmed[0].attachment.segments,original[0].attachment.segments);
  assert.strictEqual(trimmed[1].attachment,original[1].attachment);
  assert.deepEqual(trimmed[1].words.map(w=>w.start),[1.25,1.5]);
  roundTrip(trimmed);
  assert.throws(()=>trimCue(original,0,2.5,4),/gắn clip/);
});
