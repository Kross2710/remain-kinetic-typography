export type EntryPose={opacity:number;lift:number;zoom:number;blur:number};
export function webEntry(age:number):EntryPose;
export function wordRise(age:number,index:number):number;
export function karaokeFill(time:number,start:number,end:number,count:number,index:number):number;
export function inkFrame(age:number,gap:number,index:number,held?:boolean):{opacity:number;blur:number};
export function webFlowOffset(starts:number[],centers:number[],time:number):number;
export function webFlowPast(starts:number[],time:number):EntryPose;
