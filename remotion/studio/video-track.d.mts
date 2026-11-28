export type VideoClip = {id:string; mediaId:string; name:string; sourceFrames:number; inFrame:number; outFrame:number; muted:boolean};
export type VideoClipSpan = VideoClip & {startFrame:number; endFrame:number};

export function clipSpans(clips:readonly VideoClip[]):VideoClipSpan[];
export function videoTrackFrames(clips:readonly VideoClip[]):number;
export function trimClip(clips:VideoClip[], id:string, inFrame:number, outFrame:number):VideoClip[];
export function splitClip(clips:VideoClip[], id:string, timelineFrame:number, newId:string):VideoClip[];
export function moveClip(clips:VideoClip[], id:string, toIndex:number):VideoClip[];
export function removeClip(clips:VideoClip[], id:string):VideoClip[];
export function muteClip(clips:VideoClip[], id:string, muted:boolean):VideoClip[];
export function validateVideoTrack(input:unknown):VideoClip[];