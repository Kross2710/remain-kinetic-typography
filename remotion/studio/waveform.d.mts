import type {View} from './editor.mjs';
export type WaveWindow={start:number;end:number};
export type WaveBar={x:number;amplitude:number};
export type WaveEnvelope={start:number;secondsPerPeak:number;peaks:number[]};
export function waveformEnvelope(peaks:ArrayLike<number>,start:number):WaveEnvelope;
export function waveformWindow(view:View,viewportWidth:number,audioSeconds:number):WaveWindow|null;
export function visibleWaveform(peaks:ArrayLike<number>,range:WaveWindow,view:View,viewportWidth:number):WaveBar[];
