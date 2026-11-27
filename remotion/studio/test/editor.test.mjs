import {test} from 'node:test';
import assert from 'node:assert/strict';

const editor = await import('../editor.mjs');
const project = await import('../project.mjs');

const cues = () => project.importLyrics('[00:00.00]Một nhịp thở\n[00:05.00]Rồi chữ bắt đầu', 10);

// ---------------------------------------------------------------- history ---

test('commit, undo and redo walk the cue history', () => {
  const start = editor.createEditor(cues());
  const tapped = project.setWordStart(start.cues, 0, 1, 1.5, 10);
  const committed = editor.editorReducer(start, {type: 'commit', cues: tapped});
  assert.equal(committed.cues[0].words[1].start, 1.5);
  assert.equal(committed.past.length, 1);
  assert.equal(committed.future.length, 0);
  assert.ok(editor.canUndo(committed) && !editor.canRedo(committed));

  const undone = editor.editorReducer(committed, {type: 'undo'});
  // importLyrics spread the three words of "Một nhịp thở" over 0..5s.
  assert.equal(undone.cues[0].words[1].start, 1.67);
  assert.ok(undone.cues !== committed.cues);
  assert.ok(editor.canRedo(undone));

  const redone = editor.editorReducer(undone, {type: 'redo'});
  assert.equal(redone.cues[0].words[1].start, 1.5);
  assert.ok(!editor.canRedo(redone));

  // Undo/redo with nothing to walk is a no-op on the same state object.
  assert.equal(editor.editorReducer(start, {type: 'undo'}), start);
  assert.equal(editor.editorReducer(start, {type: 'redo'}), start);
});

test('a commit that changed nothing keeps history clean, and a new edit drops the redo stack', () => {
  const start = editor.createEditor(cues());
  assert.equal(editor.editorReducer(start, {type: 'commit', cues: start.cues}), start);

  const moved = editor.editorReducer(start, {type: 'commit', cues: project.setCueStart(start.cues, 1, 6, 10)});
  const undone = editor.editorReducer(moved, {type: 'undo'});
  assert.equal(undone.future.length, 1);
  const edited = editor.editorReducer(undone, {type: 'commit', cues: project.setWordStart(undone.cues, 0, 0, 0.5, 10)});
  assert.deepEqual(edited.future, []);
  assert.equal(edited.past.length, 1);
});

test('history is capped and loading a project starts a clean session', () => {
  let state = editor.createEditor(cues());
  for (let i = 0; i < editor.HISTORY_LIMIT + 20; i++) {
    const line = i % 2;
    state = editor.editorReducer(state, {type: 'commit', cues: project.setCueStart(state.cues, line, line ? 6 + (i % 3) / 30 : 1 + (i % 3) / 30, 10)});
  }
  assert.equal(state.past.length, editor.HISTORY_LIMIT);

  const loaded = editor.editorReducer(state, {type: 'reset', cues: cues()});
  assert.deepEqual(loaded.past, []);
  assert.deepEqual(loaded.future, []);
  assert.ok(!editor.canUndo(loaded));
  assert.throws(() => editor.editorReducer(state, {type: 'nonsense'}), /Action editor/);
});

// ------------------------------------------------------------- zoom / pan ---

test('zoom clamps to the timeline scale range and keeps the anchor under the cursor', () => {
  const view = editor.createView(10, 200);
  assert.equal(view.pxPerSec, 20);
  assert.equal(editor.fitPxPerSec(10, 4000), editor.MAX_PX_PER_SEC);
  assert.equal(editor.timeToX(4, view), 80);
  assert.equal(editor.xToTime(80, view), 4);

  const zoomed = editor.zoomView(view, {factor: 2, duration: 10, viewportWidth: 200, anchorTime: 4});
  assert.equal(zoomed.pxPerSec, 40);
  // The anchor was at x=80 before (80 - scrollX 0); it must stay at x=80 after.
  assert.equal(editor.timeToX(4, zoomed) - zoomed.scrollX, 80);

  const out = editor.zoomView(zoomed, {factor: 100, duration: 10, viewportWidth: 200, anchorTime: 4});
  assert.equal(out.pxPerSec, editor.MAX_PX_PER_SEC);
  const back = editor.zoomView(out, {factor: 1 / 1000, duration: 10, viewportWidth: 200});
  assert.equal(back.pxPerSec, editor.MIN_PX_PER_SEC);
  assert.equal(back.scrollX, 0);
});

test('pan and fit clamp the scroll offset to the rendered content', () => {
  const view = editor.createView(10, 200);
  assert.equal(editor.contentWidth(10, view), 200);
  assert.equal(editor.maxScrollX(10, view, 200), 0);

  const wide = editor.zoomView(view, {factor: 4, duration: 10, viewportWidth: 200});
  assert.equal(editor.maxScrollX(10, wide, 200), 600);
  assert.equal(editor.panView(wide, {deltaX: 1000, duration: 10, viewportWidth: 200}).scrollX, 600);
  assert.equal(editor.panView(wide, {deltaX: -1000, duration: 10, viewportWidth: 200}).scrollX, 0);
  assert.equal(editor.fitPxPerSec(0, 200), editor.MIN_PX_PER_SEC);
});

// ------------------------------------------------------------ project file --

test('a saved project round-trips cues, confirmed marks, range and media names', () => {
  const tapped = project.setWordStart(cues(), 0, 1, 1.5, 10);
  const json = editor.serializeProject({
    project: {width: 1280, height: 720, durationInFrames: 300, cues: tapped, videoDurationInFrames: 240},
    renderRange: {startFrame: 30, endFrame: 150},
    media: {audio: 'remain.mp3', video: null},
  });
  const loaded = editor.parseProjectFile(json);
  assert.equal(loaded.width, 1280);
  assert.equal(loaded.durationInFrames, 300);
  assert.equal(loaded.videoDurationInFrames, 240);
  assert.deepEqual(loaded.renderRange, {startFrame: 30, endFrame: 150});
  assert.deepEqual(loaded.media, {audio: 'remain.mp3', video: null});
  assert.equal(loaded.cues[0].words[1].start, 1.5);
  assert.equal(loaded.cues[0].words[1].confirmed, true);
  assert.equal(loaded.cues[0].words[0].confirmed, undefined);

  // The LRC text a saved project pastes back must keep the same line timings.
  const repasted = project.importLyrics(editor.cuesToLrc(loaded.cues), 10);
  assert.deepEqual(repasted.map(c => c.start), loaded.cues.map(c => c.start));
});

test('a project file is rejected when it is not a valid project', () => {
  assert.throws(() => editor.parseProjectFile('not json'), /JSON hợp lệ/);
  assert.throws(() => editor.parseProjectFile('[]'), /object JSON/);
  assert.throws(() => editor.parseProjectFile(JSON.stringify({version: 99, width: 720, height: 1280, durationInFrames: 300, cues: []})), /version/);
  assert.throws(() => editor.parseProjectFile(JSON.stringify({version: 1, width: 800, height: 600, durationInFrames: 300, cues: []})), /Project không hợp lệ/);
  assert.throws(() => editor.serializeProject({project: {width: 720, height: 1280, durationInFrames: 300, cues: [{text: 'một hai', start: 1, words: [{text: 'một', start: 1}]}]}}), /Số từ không khớp/);
  const minimal = editor.parseProjectFile(JSON.stringify({version: 1, width: 720, height: 1280, durationInFrames: 300, cues: [{text: 'một hai', start: 1, words: [{text: 'một', start: 1}, {text: 'hai', start: 2}]}]}));
  assert.deepEqual(minimal.media, {audio: null, video: null});
  assert.equal(minimal.renderRange, undefined);
});
