import type {View} from './editor.mjs';
import type {Cue} from './project.mjs';

export function moveCue(cues:readonly Cue[], index:number, start:number, duration:number): Cue[];
export function trimCue(cues:readonly Cue[], index:number, boundary:number, duration:number): Cue[];
export function splitCue(cues:readonly Cue[], index:number, wordIndex:number): Cue[];
export function snapTime(time:number, options:{enabled?:boolean;starts?:number[];pxPerSec:number}): number;
export function tickSteps(pxPerSec:number): {seconds:number;frames:boolean};
export function rulerTicks(view:View, viewportWidth:number, duration:number): {x:number;label?:string}[];
export function visibleCues(cues:readonly Cue[], view:View, viewportWidth:number, duration:number, focusedIndex?:number): {index:number;x:number;width:number}[];
