import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProject} from '../project.mjs';
import {createEditor, editorReducer, canUndo, canRedo} from '../editor.mjs';

const clip = Object.freeze({id:'a', mediaId:'asset-a', name:'A.mp4', sourceFrames:100, inFrame:10, outFrame:40, muted:false});
const videoTrack = Object.freeze([clip]);
const project = {width:720, height:1280, durationInFrames:30, cues:[]};

test('project validation distinguishes legacy mode from an empty video track', () => {
  assert.deepEqual(validateProject(project), project);
  assert.deepEqual(validateProject({...project, videoTrack:[]}), {...project, videoTrack:[]});
  assert.deepEqual(validateProject({...project, videoTrack}), {...project, videoTrack});
  assert.throws(() => validateProject({...project, videoTrack:null}));
});

test('project validation permits lyrics after the track but rejects clips exceeding project duration', () => {
  const cues = [{text:'hello', start:1.5, words:[{text:'hello', start:1.5}]}];
  const longer = {...project, durationInFrames:60, cues, videoTrack};
  assert.deepEqual(validateProject(longer), longer);
  assert.throws(() => validateProject({...project, durationInFrames:29, videoTrack}));
  assert.throws(() => validateProject({...project, videoTrack:[clip, {...clip, id:'b'}]}));
  assert.throws(() => validateProject({...project, videoTrack:[{...clip, outFrame:110}]}));
});

test('editor history restores both track and cues through mixed video and cue commits', () => {
  const cues = [];
  const nextCues = [{text:'hello', start:0, words:[{text:'hello', start:0}]}];
  const initial = createEditor(cues, videoTrack);
  assert.equal(initial.videoTrack, videoTrack);
  const edited = editorReducer(initial, {type:'commit', cues:nextCues});
  assert.equal(edited.videoTrack, videoTrack);
  assert.equal(canUndo(edited), true);
  const emptyTrack = [];
  const cleared = editorReducer(edited, {type:'commit', cues:nextCues, videoTrack:emptyTrack});
  assert.equal(cleared.videoTrack, emptyTrack);
  assert.equal(editorReducer(cleared, {type:'commit', cues:nextCues, videoTrack:emptyTrack}), cleared);
  const undoTrack = editorReducer(cleared, {type:'undo'});
  assert.equal(undoTrack.videoTrack, videoTrack);
  assert.equal(undoTrack.cues, nextCues);
  const undoCues = editorReducer(undoTrack, {type:'undo'});
  assert.equal(undoCues.cues, cues);
  assert.equal(undoCues.videoTrack, videoTrack);
  assert.equal(canRedo(undoCues), true);
  const redoCues = editorReducer(undoCues, {type:'redo'});
  assert.equal(redoCues.cues, nextCues);
  assert.equal(redoCues.videoTrack, videoTrack);
  assert.equal(editorReducer(redoCues, {type:'redo'}).videoTrack, emptyTrack);
});

test('undo restores legacy mode and redo restores an explicitly empty video track', () => {
  const cues = [];
  const legacy = createEditor(cues);
  assert.equal('videoTrack' in legacy, false);
  const emptyTrack = [];
  const videoMode = editorReducer(legacy, {type:'commit', cues, videoTrack:emptyTrack});
  const undone = editorReducer(videoMode, {type:'undo'});
  assert.equal('videoTrack' in undone, false);
  assert.equal(editorReducer(undone, {type:'redo'}).videoTrack, emptyTrack);
});

test('reset clears video mode when track is omitted even when cues are unchanged', () => {
  const cues = [];
  const initial = createEditor(cues, []);
  const edited = editorReducer(initial, {type:'commit', cues, videoTrack});
  const state = editorReducer(edited, {type:'undo'});
  const reset = editorReducer(state, {type:'reset', cues});
  assert.equal('videoTrack' in reset, false);
  assert.equal(canUndo(reset), false);
  assert.equal(canRedo(reset), false);
  const loaded = editorReducer(edited, {type:'reset', cues, videoTrack});
  assert.equal(loaded.videoTrack, videoTrack);
  assert.equal(canUndo(loaded), false);
});
