import type {Cue} from './project.mjs';

export type WhisperPose = {rise:number; scale:number; opacity:number; blur:number};
export function whisperEase(value:number):number;
export function firstWhisperFrame(start:number,fps:number):number;
export function whisperStack(cues:Cue[],line:number,frame:number,fps:number):{index:number;time:number;pose:WhisperPose}[];
export function whisperDrift(offset:number,entryEnd:number):number;
export function whisperGraphemes(text:string):string[];
