// Editor foundation for Remain Studio: cue/video history (undo/redo), timeline zoom
// state, and the .json project file format.
//
// Everything here is pure — no React, no DOM — so it runs under `node --test`
// and so the React reducer stays side-effect free: event handlers compute the
// next cues or video track (and catch validation errors), then commit the result.
import {validateProject} from './project.mjs';

export const HISTORY_LIMIT = 100;
// 10 px/s is the floor that still lets "Vừa khung" fit a 30s clip inside a
// phone-width lane; cue blocks keep a 28px minimum width so they stay tappable.
export const MIN_PX_PER_SEC = 10;
export const MAX_PX_PER_SEC = 400;
export const PROJECT_FILE_VERSION = 1;
export const MAX_PROJECT_FILE_BYTES = 1_048_576;

const clamp = (min, value, max) => Math.min(Math.max(value, min), max);

// ---------------------------------------------------------------- history ---

function snapshot({cues, videoTrack}) {
  return videoTrack === undefined ? {cues} : {cues, videoTrack};
}

export function createEditor(cues, videoTrack) {
  return {...snapshot({cues, videoTrack}), past: [], future: []};
}

export const canUndo = state => state.past.length > 0;
export const canRedo = state => state.future.length > 0;

export function editorReducer(state, action) {
  switch (action.type) {
    case 'commit': {
      // Omitting the track in a cue-only edit preserves the current video mode.
      const {cues, videoTrack = state.videoTrack} = action;
      if (cues === state.cues && videoTrack === state.videoTrack) return state;
      return {...snapshot({cues, videoTrack}), past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: []};
    }
    case 'undo': {
      if (!state.past.length) return state;
      return {...state.past.at(-1), past: state.past.slice(0, -1), future: [snapshot(state), ...state.future].slice(0, HISTORY_LIMIT)};
    }
    case 'redo': {
      if (!state.future.length) return state;
      return {...state.future[0], past: [...state.past, snapshot(state)].slice(-HISTORY_LIMIT), future: state.future.slice(1)};
    }
    case 'reset': {
      // Loading replaces both tracks and starts a fresh history.
      if (action.cues === state.cues && action.videoTrack === state.videoTrack && !canUndo(state) && !canRedo(state)) return state;
      return createEditor(action.cues, action.videoTrack);
    }
    default:
      throw Error(`Action editor không được biết: ${action.type}`);
  }
}

// ------------------------------------------------------------- zoom / pan ---

export function fitPxPerSec(duration, viewportWidth) {
  if (!(duration > 0) || !(viewportWidth > 0)) return MIN_PX_PER_SEC;
  return clamp(MIN_PX_PER_SEC, viewportWidth / duration, MAX_PX_PER_SEC);
}

export function createView(duration, viewportWidth) {
  return {pxPerSec: fitPxPerSec(duration, viewportWidth), scrollX: 0};
}

export const timeToX = (time, view) => time * view.pxPerSec;
export const xToTime = (x, view) => x / view.pxPerSec;
export const contentWidth = (duration, view) => Math.round(duration * view.pxPerSec);
export const maxScrollX = (duration, view, viewportWidth) => Math.max(0, contentWidth(duration, view) - (viewportWidth > 0 ? viewportWidth : 0));

export function clampView(view, {duration, viewportWidth}) {
  const pxPerSec = clamp(MIN_PX_PER_SEC, view.pxPerSec, MAX_PX_PER_SEC);
  return {pxPerSec, scrollX: clamp(0, view.scrollX, maxScrollX(duration, {pxPerSec}, viewportWidth))};
}

// Zoom keeps `anchorTime` at the same pixel offset, so the playhead or the
// cursor the user aimed at does not slide away under them.
export function zoomView(view, {factor, duration, viewportWidth, anchorTime = null}) {
  const pxPerSec = clamp(MIN_PX_PER_SEC, view.pxPerSec * factor, MAX_PX_PER_SEC);
  if (pxPerSec === view.pxPerSec) return view;
  const anchor = anchorTime ?? xToTime(view.scrollX + (viewportWidth > 0 ? viewportWidth / 2 : 0), view);
  const anchorX = anchor * view.pxPerSec - view.scrollX;
  return clampView({pxPerSec, scrollX: anchor * pxPerSec - anchorX}, {duration, viewportWidth});
}

export function panView(view, {deltaX, duration, viewportWidth}) {
  return clampView({...view, scrollX: view.scrollX + deltaX}, {duration, viewportWidth});
}

// ------------------------------------------------------------ project file --

const lrcStamp = total => {
  const seconds = Math.max(0, Math.round(total * 100) / 100);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

// Round-trip text for the lyrics editor: a saved project must paste back into
// the "02 · Lời" field as LRC the user can read and edit.
export function cuesToLrc(cues) {
  return cues.map(cue => `[${lrcStamp(cue.start)}]${cue.words.map(w => w.text).join(' ')}`).join('\n');
}

// validateProject normalises cues and keeps only {text,start}; the confirmed
// marks are editing state, so re-attach them from the source cues.
function preserveConfirmed(cues, source) {
  return cues.map((cue, i) => {
    const words = Array.isArray(source?.[i]?.words) ? source[i].words : [];
    return {...cue, words: cue.words.map((w, j) => words[j]?.confirmed ? {...w, confirmed: true} : w)};
  });
}

export function serializeProject({project, renderRange, media}) {
  const clean = validateProject({...project, ...(renderRange ? {renderRange} : {})});
  const file = {
    version: PROJECT_FILE_VERSION,
    width: clean.width,
    height: clean.height,
    durationInFrames: clean.durationInFrames,
    cues: preserveConfirmed(clean.cues, project.cues),
  };
  if (clean.effect !== undefined) file.effect=clean.effect;
  if (clean.sections !== undefined) file.sections=clean.sections;
  if (clean.showSections) file.showSections=true;
  if (clean.videoDurationInFrames !== undefined) file.videoDurationInFrames = clean.videoDurationInFrames;
  if (clean.videoTrack !== undefined) file.videoTrack=clean.videoTrack;
  if (clean.renderRange !== undefined) file.renderRange = clean.renderRange;
  // Media bytes cannot live in JSON (the editor holds object URLs), so the
  // file records the names and the user re-picks the same files on load.
  file.media = {audio: media?.audio ?? null, video: media?.video ?? null};
  return JSON.stringify(file, null, 2);
}

export function parseProjectFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error('File project không phải JSON hợp lệ.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('File project phải là một object JSON.');
  if (raw.version !== PROJECT_FILE_VERSION) throw Error(`File project phải có version ${PROJECT_FILE_VERSION}.`);
  const project = validateProject(raw);
  return {
    ...project,
    cues: preserveConfirmed(project.cues, raw.cues),
    media: {
      audio: typeof raw.media?.audio === 'string' ? raw.media.audio : null,
      video: typeof raw.media?.video === 'string' ? raw.media.video : null,
    },
  };
}
