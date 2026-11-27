import type {View} from './editor.mjs';
import type {Cue} from './project.mjs';

export function tickSteps(pxPerSec:number): {seconds:number;frames:boolean};
export function rulerTicks(view:View, viewportWidth:number, duration:number): {x:number;label?:string}[];
export function visibleCues(cues:readonly Cue[], view:View, viewportWidth:number, duration:number, focusedIndex?:number): {index:number;x:number;width:number}[];
