export const PRESETS = Object.freeze({
  classic: Object.freeze({preset:'classic',font:'serif',size:1,color:'#ece3d4',accent:'#f0b15c',entry:.28,stagger:0}),
  aurora: Object.freeze({preset:'aurora',font:'serif',size:1,color:'#ece3d4',accent:'#f0b15c',entry:.65,stagger:.045}),
  'web-match': Object.freeze({preset:'web-match',font:'serif',size:1,color:'#ffffff',accent:'#cbd8e6',entry:1.25,stagger:.05}),
  whisper: Object.freeze({preset:'whisper',font:'serif',size:1,color:'#f1e7da',accent:'#f4c28b',entry:.52,stagger:.025}),
});
export const PRESET_LABELS = Object.freeze({classic:'Classic · kiểu cũ',aurora:'Aurora · chữ lên theo nhịp',whisper:'Whisper · lời thì thầm','web-match':'Web Match'});
export const FONT_STACKS = Object.freeze({serif:'Georgia, Palatino, serif',sans:'Arial, sans-serif',mono:'Courier New, monospace'});
export const SECTION_LABELS = Object.freeze({intro:'Intro',verse:'Verse','pre-chorus':'Pre-Chorus',chorus:'Chorus',bridge:'Bridge',outro:'Outro'});
export const MAX_SECTIONS = 100;

export const MOTION_LIBRARY=Object.freeze({
  enter:Object.freeze({label:'Trồi lên và rõ dần',scope:'text'}),
  wipe:Object.freeze({label:'Karaoke · sáng dần từng ký tự',scope:'text'}),
  ink:Object.freeze({label:'Hook · chữ thấm mực',scope:'text'}),
  flow:Object.freeze({label:'Cuộn cột lời · câu cũ mờ dần',scope:'project'}),
});

export function validateMotion(motion,scope='project') {
  if(!motion || typeof motion!=='object' || Array.isArray(motion))throw Error('Thiết lập chuyển động không hợp lệ.');
  const entries=Object.entries(motion);
  for(const [key,value] of entries){
    if(!Object.hasOwn(MOTION_LIBRARY,key) || typeof value!=='boolean')throw Error('Thiết lập chuyển động không hợp lệ.');
    if(scope==='line' && MOTION_LIBRARY[key].scope==='project')throw Error('Cuộn cột lời chỉ áp dụng cho toàn bộ project.');
  }
  return Object.fromEntries(entries);
}

export function resolveMotion(project,local) {
  if(project?.preset==='web-match')return {enter:false,wipe:false,ink:false,flow:false};
  const base=project?.motion;
  return {enter:local?.enter ?? base?.enter ?? false,wipe:local?.wipe ?? base?.wipe ?? false,ink:local?.ink ?? base?.ink ?? false,flow:base?.flow ?? false};
}

export function validateEffect(effect) {
  const between=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const hex=s=>typeof s==='string'&&/^#[a-f0-9]{6}$/i.test(s);
  if (!effect || typeof effect.preset!=='string' || !Object.hasOwn(PRESETS,effect.preset) || typeof effect.font!=='string' || !Object.hasOwn(FONT_STACKS,effect.font) || !hex(effect.color) || !hex(effect.accent) || !between(effect.size,.5,1.5) || !between(effect.entry,.05,2) || !between(effect.stagger,0,.2)) throw Error('Thiết lập hiệu ứng chữ không hợp lệ.');
  const {preset,font,size,color,accent,entry,stagger,motion}=effect;
  return {preset,font,size,color,accent,entry,stagger,...(motion===undefined?{}:{motion:validateMotion(motion)})};
}

export function validateSections(sections,maxSeconds) {
  if (!Array.isArray(sections) || sections.length>MAX_SECTIONS) throw Error('Danh sách đoạn nhạc không hợp lệ.');
  return sections.map((s,i)=>{
    if (!s || typeof s.kind!=='string' || !Object.hasOwn(SECTION_LABELS,s.kind) || !Number.isFinite(s.start) || s.start<0 || s.start>=maxSeconds || (i>0 && !(sections[i-1]?.start<s.start))) throw Error('Mốc các đoạn nhạc phải hợp lệ, không trùng và tăng dần.');
    return {start:s.start,kind:s.kind};
  });
}
