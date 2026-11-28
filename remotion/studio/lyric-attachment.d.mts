import type {Cue} from './project.mjs';
import type {VideoClip} from './video-track.mjs';

export function attachCue(cues:Cue[], index:number, clips:readonly VideoClip[], clipId:string, duration:number):Cue[];
export function detachCue(cues:Cue[], index:number):Cue[];
export function splitCueAttachments(cues:Cue[], oldId:string, newId:string):Cue[];
export function removeCueAttachments(cues:Cue[], clipId:string):Cue[];
export type ActiveSceneCue = {cue:Cue; index:number; time:number; end:number};
/** Original song coordinates. For an unbounded final song cue, end is Infinity. */
export function activeSceneCues(cues:readonly Cue[], clips:readonly VideoClip[] | undefined, frame:number, fps:number):ActiveSceneCue[];