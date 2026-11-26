import {useEffect, useRef, type RefObject} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {cn} from '@/lib/utils';
import {MAX_SECONDS, type Cue} from '../project.mjs';

type Props = {
  panelRef: RefObject<HTMLElement|null>;
  cues: Cue[];
  line: number;
  selectedWord: number|null;
  liveLine: number;
  liveWord: number;
  time: number;
  playing: boolean;
  following: boolean;
  complete: boolean;
  canTap: boolean;
  onFollow: () => void;
  onMarkMode: () => void;
  onLine: (line:number) => void;
  onWord: (word:number) => void;
  onLineStart: (value:number) => boolean;
  onTap: () => void;
};

const seconds = (value:number) => `${value.toFixed(2)}s`;

export function LyricSyncPanel({panelRef,cues,line,selectedWord,liveLine,liveWord,time,playing,following,complete,canTap,onFollow,onMarkMode,onLine,onWord,onLineStart,onTap}:Props) {
  const wordsViewport=useRef<HTMLDivElement>(null);
  const cue=cues[line];
  const current=cues[liveLine];
  const confirmed=cue?.words.filter(w=>w.confirmed).length ?? 0;
  const inViewWord=following?(line===liveLine?liveWord:-1):selectedWord;

  useEffect(()=>{
    const viewport=wordsViewport.current;
    const word=viewport?.querySelector<HTMLElement>('[data-sync-focus]');
    if (!viewport || !word) return;
    const container=viewport.getBoundingClientRect();
    const item=word.getBoundingClientRect();
    if (item.top<container.top) viewport.scrollTop+=item.top-container.top-4;
    else if (item.bottom>container.bottom) viewport.scrollTop+=item.bottom-container.bottom+4;
  },[line,inViewWord]);

  return <section className="panel sync-panel min-w-0 gap-2.5!" ref={panelRef} tabIndex={-1} aria-labelledby="tap-panel-title">
    <div className="section-bar">
      <h2 id="tap-panel-title">03 · Canh từng từ</h2>
      <span className="rounded-sm border border-border px-2 py-1 text-xs tabular-nums text-muted-foreground" aria-label="Vị trí phát hiện tại">{seconds(time)}</span>
    </div>

    {!cue ? <p className="hint rounded-md border border-dashed border-border p-3">Nhập và áp dụng lời để bắt đầu canh theo video.</p> : <>
      <div role="group" aria-label="Chế độ canh lời" className="grid min-w-0 grid-cols-2 gap-1 rounded-md border border-border bg-background p-1">
        <Button type="button" variant={following?'secondary':'ghost'} aria-pressed={following} onClick={onFollow} className="min-h-[44px] min-[781px]:min-h-11 min-w-0 px-1 text-xs aria-pressed:text-primary">Theo video</Button>
        <Button type="button" variant={following?'ghost':'secondary'} aria-pressed={!following} onClick={onMarkMode} className="min-h-[44px] min-[781px]:min-h-11 min-w-0 px-1 text-xs aria-pressed:text-primary">Canh mốc</Button>
      </div>

      <div className="min-w-0 rounded-md border border-border bg-background px-2.5 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span aria-hidden="true" className={cn('size-1.5 rounded-full',playing?'bg-[#9cd4ba]':'bg-muted-foreground')}/>
            {playing?'Đang phát':'Vị trí video'}
          </span>
          <span className="truncate text-xs tabular-nums text-muted-foreground">{current?`Dòng ${liveLine+1}/${cues.length}`:'Chưa tới lời'}</span>
        </div>
        <p className="mt-1 line-clamp-2 wrap-anywhere text-sm" data-sync-preview={current ? 'active' : 'waiting'}>
          {current ? current.words.map((w,i)=><span key={i} className={i===liveWord?'font-semibold text-[#9cd4ba]':undefined}>{i>0?' ':''}{w.text}</span>) : 'Tua hoặc phát để xem lời tại vị trí hiện tại.'}
        </p>
      </div>

      <Button type="button" className="tap min-h-[44px] min-[781px]:min-h-11 w-full justify-self-stretch!" aria-keyshortcuts="Space T" disabled={!canTap} onClick={onTap}>
        Đóng dấu từ <kbd aria-hidden="true" className="rounded-sm border border-current/40 px-1.5 py-0.5 text-xs">Space / T</kbd>
      </Button>
      <p className="hint" role={complete?'status':undefined}>{complete?'Đã tới cuối lời':following?(canTap?'Bấm Space/T để bắt đầu canh từ chưa chấm.':'Dòng này đã canh xong. Chọn từ để sửa mốc.'):'Đã giữ từ đang chấm. Bấm Theo video để bám lại vị trí phát.'}</p>

      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-1.5">
        <Button type="button" variant="outline" size="icon" className="size-[44px] min-[781px]:size-11" disabled={line<=0} aria-label="Dòng trước" onClick={()=>onLine(line-1)}><span aria-hidden="true">‹</span></Button>
        <div className="grid min-w-0 gap-1">
          <label htmlFor="cue-picker">{following?'Dòng đang xem':'Dòng đang canh'}</label>
          <select className="min-h-[44px] min-[781px]:min-h-11 min-w-0 w-full truncate" id="cue-picker" value={line} onChange={e=>onLine(Number(e.target.value))}>
            {cues.map((c,i)=><option key={i} value={i}>{i+1}. {c.text}</option>)}
          </select>
        </div>
        <Button type="button" variant="outline" size="icon" className="size-[44px] min-[781px]:size-11" disabled={line>=cues.length-1} aria-label="Dòng tiếp theo" onClick={()=>onLine(line+1)}><span aria-hidden="true">›</span></Button>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{confirmed}/{cue.words.length} từ đã canh</span>
        <progress aria-label="Tiến độ canh dòng" className="h-1.5 w-16 shrink-0 accent-primary" max={cue.words.length} value={confirmed}/>
      </div>
      <div ref={wordsViewport} className="words max-h-32! overscroll-contain" role="group" aria-label="Các từ của dòng">
        {cue.words.map((w,i)=>{
          const isLive=line===liveLine && i===liveWord;
          return <Button type="button" key={i} size="sm" variant="outline" onClick={()=>onWord(i)}
            aria-current={isLive?'time':undefined} aria-pressed={i===selectedWord} data-sync-focus={i===inViewWord?'':undefined} data-confirmed={w.confirmed?'true':undefined}
            className="h-auto min-h-[44px] max-w-full gap-1.5 px-2 py-1.5 whitespace-normal min-[781px]:min-h-9 aria-pressed:border-primary aria-pressed:bg-[#483120] aria-pressed:text-[#ffd89d] aria-[current=time]:border-[#6b9d86] aria-[current=time]:text-[#b9e4d0] aria-[current=time]:aria-pressed:border-primary">
            <span className="min-w-0 wrap-anywhere text-left">{w.text}</span>
            <small className="shrink-0 tabular-nums">{seconds(w.start)}</small>
            {w.confirmed && <span aria-hidden="true" className="text-[#9cd4ba]">✓</span>}
          </Button>;
        })}
      </div>

      <label className="cue-start-field flex min-w-0 items-center justify-between gap-2 border-t border-border pt-2">Mốc đầu dòng (giây)
        <Input className="w-[90px] shrink-0" key={`${line}:${cue.start}`} type="number" min="0" max={MAX_SECONDS} step="0.01" defaultValue={cue.start} onFocus={onMarkMode} onBlur={e=>{
          const value=e.currentTarget.valueAsNumber;
          if(value!==cue.start && !onLineStart(value)) e.currentTarget.value=String(cue.start);
        }}/>
      </label>
    </>}
  </section>;
}
