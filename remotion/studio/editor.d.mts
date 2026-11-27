import type {Cue, Project, RenderRange} from './project.mjs';
import type {VideoClip} from './video-track.mjs';

type EditorSnapshot = {cues:Cue[]; videoTrack?:VideoClip[]};
export type EditorState = EditorSnapshot & {past:EditorSnapshot[]; future:EditorSnapshot[]};
export type EditorAction = ({type:'commit'} & EditorSnapshot) | {type:'undo'} | {type:'redo'} | ({type:'reset'} & EditorSnapshot);
export type View = {pxPerSec:number; scrollX:number};
export type LoadedProject = Project & {media:{audio:string|null; video:string|null}};

export const HISTORY_LIMIT:number;
export const MIN_PX_PER_SEC:number;
export const MAX_PX_PER_SEC:number;
export const PROJECT_FILE_VERSION:number;
export const MAX_PROJECT_FILE_BYTES:number;

export function createEditor(cues:Cue[], videoTrack?:VideoClip[]):EditorState;
export function editorReducer(state:EditorState, action:EditorAction):EditorState;
export function canUndo(state:EditorState):boolean;
export function canRedo(state:EditorState):boolean;

export function fitPxPerSec(duration:number, viewportWidth:number):number;
export function createView(duration:number, viewportWidth:number):View;
export function timeToX(time:number, view:View):number;
export function xToTime(x:number, view:View):number;
export function contentWidth(duration:number, view:View):number;
export function maxScrollX(duration:number, view:Pick<View,'pxPerSec'>, viewportWidth:number):number;
export function clampView(view:View, {duration, viewportWidth}:{duration:number; viewportWidth:number}):View;
export function zoomView(view:View, {factor, duration, viewportWidth, anchorTime}:{factor:number; duration:number; viewportWidth:number; anchorTime?:number|null}):View;
export function panView(view:View, {deltaX, duration, viewportWidth}:{deltaX:number; duration:number; viewportWidth:number}):View;

export function cuesToLrc(cues:Cue[]):string;
export function serializeProject({project, renderRange, media}:{project:Project; renderRange?:RenderRange|null; media?:{audio?:string|null; video?:string|null}|null}):string;
export function parseProjectFile(text:string):LoadedProject;
