import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {PRESETS,SECTION_LABELS,MAX_SECTIONS,PRESET_LABELS,MOTION_LIBRARY,type MotionId,type LineMotionSettings,type Effect,type Preset,type SectionKind,type SongSection} from '../effects.mjs';

type Props={
  effect:Effect; lineLabel?:string; lineEffect?:Effect; onChange:(effect:Effect,scope:'project'|'line')=>void; onResetLine:()=>void;
  lineMotion?:LineMotionSettings; onMotion:(id:MotionId,value:boolean|undefined,scope:'project'|'line')=>void;
  hook?:boolean; onToggleHook:()=>void;
  emphasisWord?:string; emphasized:boolean; onEmphasis:()=>void;
  sections:SongSection[]; showSections:boolean; onShowSections:(value:boolean)=>void;
  time:number; onAddSection:(kind:SectionKind)=>void; onRemoveSection:(start:number)=>void; onSeekSection:(start:number)=>void;
};

export function EffectsPanel(p:Props) {
  const [scope,setScope]=useState<'project'|'line'>('project');
  const [kind,setKind]=useState<SectionKind>('verse');
  const webMatch=p.effect.preset==='web-match';
  const activeScope=p.lineLabel&&!webMatch?scope:'project';
  const effect=activeScope==='line'?(p.lineEffect ?? p.effect):p.effect;
  const field=<K extends keyof Effect>(key:K,value:Effect[K])=>p.onChange({...effect,[key]:value},activeScope);
  const nextSection=p.sections.findIndex(s=>s.start>p.time);
  const activeSection=(nextSection<0?p.sections.length:nextSection)-1;
  const atPlayhead=p.sections.some(s=>s.start===p.time);
  return <section className="panel min-w-0" aria-labelledby="effects-title">
    <div className="section-bar"><h2 id="effects-title">Hiệu ứng chữ</h2></div>
    <label className="grid gap-1">Phạm vi hiệu ứng<select value={activeScope} onChange={e=>setScope(e.target.value as 'project'|'line')}>
      <option value="project">Toàn bộ project</option><option value="line" disabled={!p.lineLabel||webMatch}>Dòng đang chọn</option>
    </select></label>
    {activeScope==='line' && <div className="grid gap-1.5">
      <p className="hint wrap-anywhere">{p.lineLabel} · {p.lineEffect?'Kiểu riêng':'Đang dùng kiểu mặc định'}</p>
      <Button type="button" variant="outline" size="sm" disabled={!p.lineEffect} onClick={p.onResetLine}>Dùng kiểu mặc định</Button>
    </div>}
    <label className="grid gap-1">Preset chữ<select value={effect.preset} onChange={e=>p.onChange({...PRESETS[e.target.value as Preset]},activeScope)}>
      {Object.entries(PRESET_LABELS).map(([id,label])=><option key={id} value={id} disabled={id==='web-match'&&activeScope==='line'}>{label}</option>)}
    </select></label>
    {webMatch?<p className="hint">Dùng font, màu và chuyển động từ bản web. Bỏ qua kiểu riêng từng dòng, không xoá thiết lập đã lưu.</p>:<>
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className="grid min-w-0 gap-1">Font chữ<select value={effect.font} onChange={e=>field('font',e.target.value as Effect['font'])}><option value="serif">Serif</option><option value="sans">Sans-serif</option><option value="mono">Monospace</option></select></label>
      <label className="grid min-w-0 gap-1">Cỡ chữ ({Math.round(effect.size*100)}%)<input type="range" min="50" max="150" step="5" value={Math.round(effect.size*100)} onChange={e=>field('size',Number(e.target.value)/100)}/></label>
      <label className="grid gap-1">Màu chữ<Input className="min-h-9 p-1" type="color" value={effect.color} onChange={e=>field('color',e.target.value)}/></label>
      <label className="grid gap-1">Màu nhấn<Input className="min-h-9 p-1" type="color" value={effect.accent} onChange={e=>field('accent',e.target.value)}/></label>
      <label className="grid min-w-0 gap-1">Vào chữ ({effect.entry.toFixed(2)}s)<input type="range" min=".05" max="2" step=".005" value={effect.entry} onChange={e=>field('entry',Number(e.target.value))}/></label>
      <label className="grid min-w-0 gap-1">Trễ từ ({effect.stagger.toFixed(3)}s)<input type="range" min="0" max=".2" step=".005" value={effect.stagger} onChange={e=>field('stagger',Number(e.target.value))}/></label>
    </div>
    <Button type="button" variant="outline" aria-pressed={p.emphasized} disabled={!p.emphasisWord} onClick={p.onEmphasis} className="h-auto min-h-[44px] whitespace-normal wrap-anywhere">
      {p.emphasisWord?`${p.emphasized?'Bỏ nhấn':'Nhấn từ'}: ${p.emphasisWord}`:'Chọn từ trong mục Canh từng từ để nhấn'}
    </Button>
    <fieldset className="grid gap-1.5 rounded-lg border border-border px-2.5 pb-2.5">
      <legend className="px-1 font-medium">Hiệu ứng dùng chung</legend>
      {(Object.keys(MOTION_LIBRARY) as MotionId[]).map(id=>{
        const entry=MOTION_LIBRARY[id];
        if(activeScope==='project')return <label key={id} className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={p.effect.motion?.[id]===true} onChange={e=>p.onMotion(id,e.target.checked,'project')}/>{entry.label}
        </label>;
        if(id==='flow')return null;
        const current=p.lineMotion?.[id];
        return <label key={id} className="grid gap-1">{entry.label}<select value={current===undefined?'inherit':current?'on':'off'} onChange={e=>p.onMotion(id,e.target.value==='inherit'?undefined:e.target.value==='on','line')}>
          <option value="inherit">Theo project ({p.effect.motion?.[id]?'bật':'tắt'})</option><option value="on">Bật cho dòng này</option><option value="off">Tắt cho dòng này</option>
        </select></label>;
      })}
      <p className="hint">Hiệu ứng dùng được với Classic, Aurora và Whisper. Thấm mực thay hiệu ứng vào chữ trên dòng hook.</p>
    </fieldset>
    </>}
    <Button type="button" variant="outline" aria-pressed={p.hook===true} disabled={!p.lineLabel} onClick={p.onToggleHook} className="h-auto min-h-[44px] whitespace-normal">
      {p.hook?'Bỏ dấu hook':'Đánh dấu hook'}
    </Button>
    <div className="mt-2 grid min-w-0 gap-2 border-t border-border pt-2">
      <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={p.showSections} onChange={e=>p.onShowSections(e.target.checked)}/>Hiện thanh Verse/Chorus trong video</label>
      {p.showSections && <>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <label className="grid min-w-0 gap-1">Loại đoạn<select value={kind} onChange={e=>setKind(e.target.value as SectionKind)}>{Object.entries(SECTION_LABELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <Button type="button" size="sm" className="min-h-[44px]" disabled={!atPlayhead && p.sections.length>=MAX_SECTIONS} onClick={()=>p.onAddSection(kind)}>{atPlayhead?'Đổi đoạn tại mốc':'Thêm đoạn tại playhead'}</Button>
        </div>
        <p className="hint">Mốc hiện tại: {p.time.toFixed(2)}s. Mỗi đoạn kéo dài đến mốc kế tiếp.</p>
        <ul className="m-0 grid max-h-40 list-none gap-1 overflow-auto p-0" aria-label="Mốc đoạn nhạc">
          {p.sections.map((s,i)=><li key={s.start} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-1">
            <Button type="button" variant="outline" size="sm" aria-current={activeSection===i?'time':undefined} className="min-h-[44px] justify-start aria-[current=time]:border-primary" onClick={()=>p.onSeekSection(s.start)}>{SECTION_LABELS[s.kind]} · {s.start.toFixed(2)}s</Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" aria-label={`Xóa ${SECTION_LABELS[s.kind]} tại ${s.start.toFixed(2)}s`} onClick={()=>p.onRemoveSection(s.start)}>Xóa</Button>
          </li>)}
        </ul>
      </>}
    </div>
  </section>;
}
