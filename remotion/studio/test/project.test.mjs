import {test} from 'node:test';
import assert from 'node:assert/strict';

const project = await import('../project.mjs').catch(e => {if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; return {};});
const input = '[00:02.50]Trời ơi\n[00:00.50]<00:00.50>Một <00:01.00>hai';

test('LRC and enhanced LRC keep line and word timing in order', () => {
  const cues = project.importLyrics(input, 4);
  assert.deepEqual(cues.map(c => [c.text,c.start]), [['Một hai',.5],['Trời ơi',2.5]]);
  assert.equal(cues[0].words[1].start, 1);
  assert.equal(cues[1].words[0].start, 2.5);
  assert.equal(project.importLyrics('[00:00.034]Một hai', 1)[0].words[0].start, .034);
  const fromPlain = project.importLyrics('Mùa thu\nMùa đông', 4);
  assert.deepEqual(fromPlain.map(c => c.start), [0, 2]);
  assert.deepEqual(fromPlain[0].words.map(w => w.start), [0, 1]);
  assert.throws(() => project.importLyrics('[00:01.00]First\nMissing time', 4));
  assert.throws(() => project.importLyrics('[00:01.00]<00:01.00>First <00:05.00>Late\n[00:02.00]Second', 4));
});

test('tap cannot cross its neighbors; moving a line retimes its words', () => {
  const cues = project.importLyrics('one two three\nnext line', 6);
  assert.equal(project.setWordStart(cues, 0, 1, .8, 6)[0].words[1].start, .8);
  assert.equal(project.setWordStart(cues, 0, 1, 20/30, 6)[0].words[1].start, 20/30);
  const firstTap = project.setWordStart(cues, 0, 0, 1.5, 6);
  assert.equal(firstTap[0].words[0].start, 1.5);
  assert.ok(firstTap[0].words[1].start > 1.5);
  assert.throws(() => project.setWordStart(firstTap, 0, 1, 1, 6));
  const lastTap = project.setWordStart(cues, 0, 2, 2.5, 6);
  assert.throws(() => project.setWordStart(lastTap, 0, 1, 2.8, 6));
  const lrc = project.importLyrics(input,4);
  assert.throws(() => project.setWordStart(lrc,0,0,1.1,4));
  const moved = project.setCueStart(cues, 0, .5, 6);
  assert.deepEqual(moved[0].words.map(w => w.start), [.5,1.33,2.17]);
  assert.equal(cues[0].start, 0);
});

test('continuous tapping uses the beat instead of estimated line boundaries', () => {
  let cues=project.importLyrics('[00:00.00]one two three\n[00:06.00]next line\n[00:10.00]last line', 14);
  cues=project.setWordStart(cues,0,0,1.2,14);
  cues=project.setWordStart(cues,0,1,2.4,14);
  // The next line was estimated at 6s; the actual first word arrives at 4s.
  cues=project.setWordStart(cues,1,0,4,14);
  assert.equal(cues[1].start,4);
  assert.equal(cues[1].words[0].start,4);
  assert.equal(cues[0].words[1].start,2.4);
  assert.ok(cues[0].words[2].start < 4);
  // A late final word is allowed to push the next untapped line, too.
  cues=project.setWordStart(cues,1,1,10.3,14);
  assert.ok(cues[2].start>10.3);
  assert.equal(cues[1].words[0].start,4);
  cues=project.setWordStart(cues,2,0,10.5,14);
  assert.equal(cues[2].start,10.5);
  assert.throws(()=>project.setWordStart(cues,2,0,10.2,14));
  assert.doesNotThrow(()=>project.validateProject({width:720,height:1280,durationInFrames:420,cues}));
});

test('shorter preview and export never erase edited cues or word timing', () => {
  const cues = project.importLyrics('[00:00.00]one two\n[00:06.00]late cue', 2, 30);
  assert.deepEqual(cues.map(c=>c.start),[0,6]);
  const edited = project.setWordStart(cues,0,1,4,10);
  const trimmed = project.clipCues(edited,2);
  assert.equal(trimmed.length,1);
  assert.ok(trimmed[0].words[1].start < 2);
  assert.deepEqual(project.activeAt(trimmed,59/30),[0,0]);
  assert.equal(project.clipCues(edited,10)[0].words[1].start,4);
  assert.equal(project.clipCues(edited,10)[1].start,6);
});

test('frame state can seek backward without stale highlights', () => {
  const cues = project.importLyrics(input, 4);
  assert.deepEqual(project.activeAt(cues, 3), [1,0]);
  assert.deepEqual(project.activeAt(cues, 1), [0,1]);
  assert.deepEqual(project.activeAt(cues, 0.1), [-1,-1]);
});

test('export preserves a bounded exclusive frame range without shifting lyric cues', () => {
  const p={width:720,height:1280,durationInFrames:3600,cues:project.importLyrics('[01:10.00]Late lyric',120),videoDurationInFrames:3060};
  const range=project.rangeFromSeconds('70','75',p.durationInFrames);
  assert.deepEqual(range,{startFrame:2100,endFrame:2250});
  const clean=project.validateProject({...p,renderRange:range});
  assert.equal(clean.cues[0].start,70);
  assert.equal(clean.videoDurationInFrames,3060);
  assert.deepEqual(clean.renderRange,range);
  assert.equal(project.validateProject(p).renderRange,undefined);
  assert.throws(()=>project.validateProject({...p,videoDurationInFrames:3601}));
  assert.throws(()=>project.validateProject({...p,renderRange:{startFrame:-1,endFrame:1}}));
  assert.throws(()=>project.validateProject({...p,renderRange:{startFrame:0,endFrame:3601}}));
  for (const bounds of [['','1'],['1','1'],['70','69'],['70','121'],['abc','90']]) assert.throws(()=>project.rangeFromSeconds(...bounds,3600));
});

test('the timeline follows the longest loaded asset, not the demo duration', () => {
  assert.equal(project.timelineLength(null,null),900);
  assert.equal(project.timelineLength(37.2,null),1116);
  assert.equal(project.timelineLength(3,42.5),1275);
  assert.equal(project.timelineLength(3,2),90);
  assert.equal(project.timelineLength(null,1/30),1);
});

test('export validates bounded render data and strips extra keys', () => {
  const p = {width:720,height:1280,durationInFrames:120,cues:project.importLyrics(input,4),audioURL:'https://example.com'};
  assert.equal(project.validateProject(p).audioURL, undefined);
  assert.throws(() => project.validateProject({...p,width:900}));
  assert.throws(() => project.validateProject({...p,durationInFrames:216001}));
  assert.equal(project.validateProject({...p,durationInFrames:3300}).durationInFrames,3300);
  assert.deepEqual(project.validateProject({...p,cues:[]}).cues,[]);
  assert.throws(() => project.validateProject({...p,cues:[...p.cues].reverse()}));
  assert.throws(() => project.validateProject({...p,cues:[{text:'wrong',start:0,words:[{text:'different',start:0}]}]}));
});
