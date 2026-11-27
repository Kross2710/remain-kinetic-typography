export const PRESETS = Object.freeze({
  classic: Object.freeze({preset:'classic',font:'serif',size:1,color:'#ece3d4',accent:'#f0b15c',entry:.28,stagger:0}),
  aurora: Object.freeze({preset:'aurora',font:'serif',size:1,color:'#ece3d4',accent:'#f0b15c',entry:.65,stagger:.045}),
});
export const FONT_STACKS = Object.freeze({serif:'Georgia, Palatino, serif',sans:'Arial, sans-serif',mono:'Courier New, monospace'});
export const SECTION_LABELS = Object.freeze({intro:'Intro',verse:'Verse','pre-chorus':'Pre-Chorus',chorus:'Chorus',bridge:'Bridge',outro:'Outro'});
export const MAX_SECTIONS = 100;

export function validateEffect(effect) {
  const between=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const hex=s=>typeof s==='string'&&/^#[a-f0-9]{6}$/i.test(s);
  if (!effect || typeof effect.preset!=='string' || !Object.hasOwn(PRESETS,effect.preset) || typeof effect.font!=='string' || !Object.hasOwn(FONT_STACKS,effect.font) || !hex(effect.color) || !hex(effect.accent) || !between(effect.size,.5,1.5) || !between(effect.entry,.05,2) || !between(effect.stagger,0,.2)) throw Error('Thiết lập hiệu ứng chữ không hợp lệ.');
  const {preset,font,size,color,accent,entry,stagger}=effect;
  return {preset,font,size,color,accent,entry,stagger};
}

export function validateSections(sections,maxSeconds) {
  if (!Array.isArray(sections) || sections.length>MAX_SECTIONS) throw Error('Danh sách đoạn nhạc không hợp lệ.');
  return sections.map((s,i)=>{
    if (!s || typeof s.kind!=='string' || !Object.hasOwn(SECTION_LABELS,s.kind) || !Number.isFinite(s.start) || s.start<0 || s.start>=maxSeconds || (i>0 && !(sections[i-1]?.start<s.start))) throw Error('Mốc các đoạn nhạc phải hợp lệ, không trùng và tăng dần.');
    return {start:s.start,kind:s.kind};
  });
}
