// Frame-derived versions of the public player's motion curves. Web Match
// itself keeps the original GSAP path for full-composition fidelity.
const clamp=value=>Math.max(0,Math.min(1,value));
const out=(value,power)=>1-(1-clamp(value))**power;
const mix=(from,to,p)=>p===1?to:from+(to-from)*p;

export function webEntry(age){
  const p=out(age/1.25,3);
  return {opacity:p,lift:14*(1-p),zoom:mix(.99,1.04,p),blur:10*(1-p)};
}
export const wordRise=(age,index)=>110*(1-out((age-index*.05)/1.1,4));
export function karaokeFill(time,start,end,count,index){
  const progress=clamp((time-start)/Math.max(.0001,Math.min(end-start,.8)));
  return clamp(progress*count-index);
}
export function inkFrame(age,gap,index,held=false){
  const p=out((age-index*gap)/(held ? .85 : .95),3);
  return {opacity:mix(.04,1,p),blur:3*(1-p)};
}

export function webFlowOffset(starts,centers,time){
  if(!starts.length)return 0;
  let target=-centers[0],from=target,start=starts[0];
  for(let i=1;i<starts.length && starts[i]<=time;i++){
    from=mix(from,target,out((starts[i]-start)/1.35,3));
    target=-centers[i];start=starts[i];
  }
  return mix(from,target,out((time-start)/1.35,3));
}

export function webFlowPast(starts,time){
  const forDepth=index=>({opacity:Math.max(0,.62-index*.15),blur:Math.min(.6+index*.85,3.4),zoom:.9,lift:-14});
  const blend=(a,b,p)=>({opacity:mix(a.opacity,b.opacity,p),blur:mix(a.blur,b.blur,p),zoom:mix(a.zoom,b.zoom,p),lift:mix(a.lift,b.lift,p)});
  let from={opacity:1,blur:0,zoom:1,lift:0};
  if(!starts.length)return from;
  let start=starts[0],target=forDepth(0);
  for(let i=1;i<starts.length && starts[i]<=time;i++){
    from=blend(from,target,out((starts[i]-start)/1.05,3));
    start=starts[i];target=forDepth(i);
  }
  return blend(from,target,out((time-start)/1.05,3));
}
