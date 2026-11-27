import assert from 'node:assert/strict';
import test from 'node:test';
import {parseProjectFile, serializeProject} from '../editor.mjs';
import {activeSceneCues, attachCue, detachCue, removeCueAttachments, splitCueAttachments} from '../lyric-attachment.mjs';
import {defaultPerspectiveCorners} from '../perspective.mjs';
import {MAX_SECONDS, validateProject} from '../project.mjs';
import {moveClip, splitClip, trimClip} from '../video-track.mjs';

const line = (text, start) => ({text, start, words:[{text,start}]});
const clip = (id, inFrame, outFrame) => ({id, mediaId:id, name:`${id}.mp4`, sourceFrames:600, inFrame, outFrame, muted:false});

const prefix = clip('prefix', 0, 60);
const target = clip('target', 90, 210);
const cues = [line('One', 2), line('Two', 5)];

test('attach records the current clip offset and original line end without duplicating the cue', () => {
  const attached = attachCue(cues, 0, [prefix,target], target.id, 6);
  assert.deepEqual(attached, [{...cues[0],attachment:{end:5,segments:[{clipId:target.id,offsetFrames:30}]}},cues[1]]);
  assert.strictEqual(attached[0].words, cues[0].words);
  assert.strictEqual(attachCue(attached, 0, [prefix,target], target.id, 6), attached);
  assert.equal(attachCue(cues, 1, [prefix,target], target.id, 6)[1].attachment.end, 6);
});

test('splitting retains the original cue and gives both clip IDs the same offset', () => {
  const attached = attachCue(cues, 0, [prefix,target], target.id, 6);
  const split = splitCueAttachments(attached, target.id, 'right');
  assert.deepEqual(split[0], {...cues[0],attachment:{end:5,segments:[
    {clipId:target.id,offsetFrames:30}, {clipId:'right',offsetFrames:30},
  ]}});
  assert.strictEqual(split[1], cues[1]);
  assert.strictEqual(splitCueAttachments(split, target.id, 'right'), split);
});

test('removing one segment only deletes the cue when its last segment is removed', () => {
  const attached = attachCue(cues, 0, [prefix,target], target.id, 6);
  const split = splitCueAttachments(attached, target.id, 'right');
  assert.strictEqual(removeCueAttachments(split, prefix.id), split);
  const remaining = removeCueAttachments(split, 'right');
  assert.deepEqual(remaining, attached);
  assert.deepEqual(removeCueAttachments(remaining, target.id), [cues[1]]);
});

test('detaching restores the original song cue unchanged', () => {
  const attached = attachCue(cues, 0, [prefix,target], target.id, 6);
  assert.deepEqual(detachCue(attached, 0), cues);
  assert.strictEqual(detachCue(cues, 0), cues);
});

test('splitting does not change source time or duplicate a lyric at the cut', () => {
  const clips = [prefix,target];
  const attached = attachCue(cues, 0, clips, target.id, 6);
  const split = splitCueAttachments(attached, target.id, 'right');
  const splitClips = splitClip(clips, target.id, 100, 'right');
  assert.deepEqual(activeSceneCues(split, splitClips, 59, 30), []);
  for (const frame of [60, 99, 100, 149]) {
    assert.deepEqual(activeSceneCues(split, splitClips, frame, 30), [{cue:split[0],index:0,time:frame/30,end:5}]);
  }
  assert.deepEqual(activeSceneCues(split, splitClips, 150, 30), [{cue:cues[1],index:1,time:5,end:6}]);
});

test('moving a split half preserves source time and clips it to its new exclusive bounds', () => {
  const clips = [prefix,target];
  const attached = attachCue(cues, 0, clips, target.id, 6);
  const split = splitCueAttachments(attached, target.id, 'right');
  const splitClips = splitClip(clips, target.id, 100, 'right');
  const moved = moveClip(splitClips, 'right', 0);
  const trimmed = trimClip(moved, 'right', 131, 160);
  assert.deepEqual(activeSceneCues(split, trimmed, 0, 30), [{cue:split[0],index:0,time:101/30,end:5}]);
  assert.deepEqual(activeSceneCues(split, trimmed, 28, 30), [{cue:split[0],index:0,time:129/30,end:5}]);
  assert.deepEqual(activeSceneCues(split, trimmed, 29, 30), []);
  assert.deepEqual(activeSceneCues(split, trimmed, 89, 30), [{cue:split[0],index:0,time:2,end:5}]);
  assert.deepEqual(activeSceneCues(split, trimmed, 128, 30), [{cue:split[0],index:0,time:99/30,end:5}]);
  assert.deepEqual(activeSceneCues(split, trimmed, 129, 30), []);
});

test('moved attachments may overlap the current song cue', () => {
  const clips = [prefix,target];
  const attached = attachCue(cues, 0, clips, target.id, 6);
  assert.deepEqual(activeSceneCues(attached, [clip('pad',0,150),target], 150, 30), [
    {cue:attached[0],index:0,time:2,end:5}, {cue:cues[1],index:1,time:5,end:9},
  ]);
});

test('an attached line no longer sets the end of a song-layer cue', () => {
  const clips = [prefix,target];
  const attached = attachCue(cues, 1, clips, target.id, 6);
  const reordered = [target,prefix];
  assert.deepEqual(activeSceneCues(attached, reordered, 150, 30), [{cue:cues[0],index:0,time:5,end:6}]);
});

test('cue perspective round-trips through validation and a project file', () => {
  const perspective = {corners:defaultPerspectiveCorners(),aspect:'tall'};
  perspective.corners[0].x = -0.1;
  const project = {width:1280,height:720,durationInFrames:180,cues:[{...cues[0],perspective}]};
  assert.deepEqual(validateProject(project), project);
  assert.deepEqual(parseProjectFile(serializeProject({project})).cues, project.cues);
});

test('cue perspective rejects a crossed quad or unknown aspect', () => {
  const [tl,tr,br,bl] = defaultPerspectiveCorners();
  const project = {width:720,height:1280,durationInFrames:180,cues:[cues[0]]};
  for (const perspective of [{corners:[tl,br,tr,bl],aspect:'wide'}, {corners:[tl,tr,br,bl],aspect:'square'}]) {
    assert.throws(() => validateProject({...project,cues:[{...cues[0],perspective}]}));
  }
});

test('shortening the video retains attachment and original line and word timestamps through export/save validation', () => {
  const words = [{text:'One',start:2}, {text:'two',start:2.3}];
  const source = [{text:'One two',start:2,words},cues[1]];
  const clips = [prefix,target];
  const attached = attachCue(source, 0, clips, target.id, 6);
  const videoTrack = trimClip([target], target.id, 90, 105);
  const project = {width:1280,height:720,durationInFrames:15,renderRange:{startFrame:0,endFrame:15},videoTrack,cues:attached};
  const clean = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(clean, project);
  assert.deepEqual(parseProjectFile(serializeProject({project})).cues, attached);
  assert.deepEqual(activeSceneCues(clean.cues, clean.videoTrack, 9, 30), [{cue:attached[0],index:0,time:2.3,end:5}]);
});

test('attachment validation rejects malformed intervals, segments and clip references', () => {
  const segment = {clipId:target.id,offsetFrames:-20};
  const project = {width:720,height:1280,durationInFrames:180,videoTrack:[prefix,target]};
  const validate = attachment => validateProject({...project,cues:[{...cues[0],attachment}]});
  assert.deepEqual(validate({end:5,segments:[segment]}).cues[0].attachment, {end:5,segments:[segment]});
  for (const attachment of [null, {end:2,segments:[segment]}, {end:MAX_SECONDS+1,segments:[segment]}, {end:Infinity,segments:[segment]},
    {end:5,segments:[]}, {end:5,segments:[segment,segment]}, {end:5,segments:[{...segment,clipId:'missing'}]},
    {end:5,segments:[{...segment,offsetFrames:0.5}]}, {end:5,segments:[null]}]) {
    assert.throws(() => validate(attachment));
  }
  assert.throws(() => validateProject({...project,videoTrack:undefined,cues:[{...cues[0],attachment:{end:5,segments:[segment]}}]}));
});

test('only video mode relaxes the timing bound, and original song time still cannot exceed MAX_SECONDS', () => {
  const project = {width:720,height:1280,durationInFrames:15,cues:[cues[0]]};
  assert.throws(() => validateProject(project));
  assert.deepEqual(validateProject({...project,videoTrack:[]}).cues, project.cues);
  assert.throws(() => validateProject({...project,videoTrack:[],cues:[line('Late', MAX_SECONDS)]}));
});