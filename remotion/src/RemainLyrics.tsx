import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
  interpolateColors,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
// Video dùng @remotion/media (h264 WebCodecs -> preview mượt, không rớt frame như OffthreadVideo).
// Audio dùng <Audio> CORE của remotion: preview phát qua HTML5 <audio> (Chrome decode FLAC native).
// KHÔNG dùng @remotion/media Audio cho FLAC: nó decode bằng WebCodecs/mediabunny -> macOS fail
// "InternalAudioDecoderCocoa decoding failed". (Render thì cả hai đều ổn vì đi ffmpeg.)
import { Video } from '@remotion/media';
import { z } from 'zod';
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadInstrument } from '@remotion/google-fonts/InstrumentSerif';
import { parseLRC } from './lib/lrc';
import { getWordTimings, Seg } from './lib/wordTimings';
import { PALETTE, SECTIONS } from './lib/sections';
import {
  ACTIVE_SCALE,
  clamp01,
  eased,
  ENTER_DUR,
  INNER_DUR,
  INNER_STAGGER,
  lerp,
  P2_OUT,
  P3_OUT,
  pastTarget,
  PAST_DUR,
  REVEAL_DUR,
  REVEAL_STAGGER,
  SCROLL_DUR,
  SINE_INOUT,
  SOAK_BLUR,
  SOAK_DUR,
  SOAK_STAGGER,
} from './lib/anim';
import { RAW_LRC } from './data/lrc';
import './style.css';

// chỉ nạp weight/subset thực dùng -> ít request, bundle nhanh, render tất định
loadFraunces('normal', { weights: ['300', '400'], subsets: ['latin'] });
loadInstrument('italic', { weights: ['400'], subsets: ['latin'] });

// Schema props -> Remotion Studio hiện ô nhập: đổi/xoá tên video nền ngay trên UI (xoá rỗng = chỉ aurora).
export const remainSchema = z.object({
  bgVideo: z.string().describe('Tên file video nền trong public/ (để rỗng = chỉ dùng nền aurora). Video LUÔN muted.'),
});
export type RemainProps = z.infer<typeof remainSchema>;

const HOOK_RE = /i will remain/i;
const WIPE_MAX_SEC = 0.8;
const CENTER_RATIO = 0.58; // dòng đang hát canh ở 58% chiều cao (như bản gốc)
const normWord = (s: string) => (s || '').toLowerCase().replace(/[^a-z']/g, '');

// ---- models ----
type CharM = { ch: string; cp: number; opacity: number; blur: number };
type WordM = { chars: CharM[]; innerY: number; hidden: boolean };
type LineM = {
  key: number;
  isHook: boolean;
  active: boolean;
  opacity: number;
  blur: number;
  transform: string;
  words: WordM[];
  empty?: boolean; // cue rỗng cuối bài: giữ chỗ trong list (cho active-index/endTimeOf) nhưng không render
};

function endTimeOf(cues: { time: number }[], i: number) {
  return i + 1 < cues.length ? cues[i + 1].time : cues[i].time + 4;
}

// cp từng ký tự của 1 từ tại t — port updateHighlight (wipe trái→phải, cap WIPE_MAX_SEC).
function charProgress(seg: Seg, t: number, n: number): number[] {
  const wipeEnd = Math.min(seg.end, seg.start + WIPE_MAX_SEC);
  const d = Math.max(0.0001, wipeEnd - seg.start);
  const base = clamp01((t - seg.start) / d);
  return Array.from({ length: n }, (_, j) => clamp01(base * n - j));
}

type LineViewProps = { m: LineM; refCb: (el: HTMLDivElement | null) => void };
const LineViewImpl: React.FC<LineViewProps> = ({ m, refCb }) => {
  if (m.empty) return <div ref={refCb} className="kt-line" style={{ height: 0, overflow: 'hidden', opacity: 0 }} />;
  return (
    <div
      ref={refCb}
      className={`kt-line${m.active ? ' kt-active' : ''}${m.isHook ? ' kt-hook' : ''}`}
      style={{ opacity: m.opacity, transform: m.transform, filter: m.blur ? `blur(${m.blur}px)` : undefined }}
    >
      {m.words.map((w, wi) => (
        <span className="kt-word" key={wi} style={{ opacity: w.hidden ? 0 : 1 }}>
          <span className="kt-mask">
            <span className="kt-word-inner" style={{ transform: `translateY(${w.innerY}%)` }}>
              {w.chars.map((c, ci) => (
                <span
                  className="kt-char"
                  key={ci}
                  style={
                    {
                      '--cp': c.cp.toFixed(3),
                      opacity: c.opacity,
                      filter: c.blur ? `blur(${c.blur}px)` : undefined,
                    } as React.CSSProperties
                  }
                >
                  {c.ch}
                </span>
              ))}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
};

// So khớp model: chỉ re-render khi dòng THỰC SỰ đổi (active + dòng đang chuyển). Dòng tĩnh -> React bỏ qua.
function lineEqual(a: LineM, b: LineM): boolean {
  if (
    a.active !== b.active || a.opacity !== b.opacity || a.blur !== b.blur ||
    a.transform !== b.transform || a.isHook !== b.isHook || a.empty !== b.empty ||
    a.words.length !== b.words.length
  ) return false;
  for (let i = 0; i < a.words.length; i++) {
    const wa = a.words[i], wb = b.words[i];
    if (wa.innerY !== wb.innerY || wa.hidden !== wb.hidden || wa.chars.length !== wb.chars.length) return false;
    for (let j = 0; j < wa.chars.length; j++) {
      const ca = wa.chars[j], cb = wb.chars[j];
      if (ca.cp !== cb.cp || ca.opacity !== cb.opacity || ca.blur !== cb.blur) return false;
    }
  }
  return true;
}
const LineView = React.memo(LineViewImpl, (p, n) => p.refCb === n.refCb && lineEqual(p.m, n.m));

export const RemainLyrics: React.FC<RemainProps> = ({ bgVideo }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const hasVideo = !!bgVideo && bgVideo.trim() !== '';

  // giữ CẢ cue rỗng cuối bài (mốc "clear màn hình") — vanilla không lọc, dòng cuối nhờ đó lùi đi.
  const cues = useMemo(() => parseLRC(RAW_LRC), []);

  // dòng đang hát
  let active = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time <= t) active = i;
    else break;
  }

  // ---- đo offset tâm từng dòng MỘT LẦN (transform không reflow -> offset tĩnh) ----
  const [handle] = useState(() => delayRender('measure-lines'));
  const [centers, setCenters] = useState<number[] | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // refCb ổn định theo từng dòng -> React.memo so sánh được (không tạo hàm mới mỗi frame)
  const refCbs = useMemo(
    () => cues.map((_, i) => (el: HTMLDivElement | null) => { lineRefs.current[i] = el; }),
    [cues.length],
  );
  useEffect(() => {
    if (centers) return;
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      if (cancelled) return;
      const cs = lineRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0));
      setCenters(cs);
      continueRender(handle);
    })();
    return () => {
      cancelled = true;
    };
  }, [handle, centers]);

  // ---- cuộn recenter mượt (1.35s power2.out) ----
  let scrollY = 0;
  if (centers) {
    const centerY = height * CENTER_RATIO;
    const targetOf = (i: number) => centerY - (centers[i] ?? 0);
    if (active < 0) {
      scrollY = targetOf(0); // trước câu đầu: màn hình trống, giá trị không nhìn thấy
    } else if (!cues[active].text) {
      // cue rỗng cuối bài: GIỮ tâm ở dòng text cuối (vanilla recenter() return sớm khi el null)
      scrollY = targetOf(active - 1);
    } else if (active === 0) {
      // câu mở đầu CUỘN VÀO tâm từ y=0 trong 1.35s (vanilla animate lần recenter đầu tiên)
      scrollY = lerp(0, targetOf(0), eased(t, cues[0].time, SCROLL_DUR, P2_OUT));
    } else {
      scrollY = lerp(targetOf(active - 1), targetOf(active), eased(t, cues[active].time, SCROLL_DUR, P2_OUT));
    }
  }

  // ---- aurora lerp màu 2.6s sine.inOut tại ranh giới đoạn ----
  let sIdx = SECTIONS.findIndex((s) => t < s.end);
  if (sIdx < 0) sIdx = SECTIONS.length - 1;
  const curK = SECTIONS[sIdx].kind;
  const prevK = sIdx > 0 ? SECTIONS[sIdx - 1].kind : curK;
  const boundary = sIdx > 0 ? SECTIONS[sIdx - 1].end : -1e9;
  const cp = eased(t, boundary, 2.6, SINE_INOUT);
  const au1 = interpolateColors(cp, [0, 1], [PALETTE[prevK].au1, PALETTE[curK].au1]);
  const au2 = interpolateColors(cp, [0, 1], [PALETTE[prevK].au2, PALETTE[curK].au2]);
  const accent = interpolateColors(cp, [0, 1], [PALETTE[prevK].accent, PALETTE[curK].accent]);

  // ---- dựng model cho TẤT CẢ dòng (render hết để đo offset + cuộn tích tụ) ----
  const models: LineM[] = cues.map((cue, i) => {
    const isHook = HOOK_RE.test(cue.text);
    const words = cue.text.split(/\s+/).filter(Boolean);

    // cue rỗng (mốc clear cuối bài): giữ chỗ ref height 0, không render nội dung
    if (!cue.text) {
      return { key: i, isHook: false, active: false, opacity: 0, blur: 0, transform: 'none', words: [], empty: true };
    }

    // FUTURE: ẩn hẳn (vẫn chiếm layout)
    if (i > active) {
      return {
        key: i,
        isHook,
        active: false,
        opacity: 0,
        blur: 0,
        transform: 'translateY(0px) scale(1)',
        words: words.map((w) => ({ chars: Array.from(w).map((ch) => ({ ch, cp: 0, opacity: 1, blur: 0 })), innerY: 0, hidden: false })),
      };
    }

    // PAST: exhale-out + lùi xa theo khoảng cách
    if (i < active) {
      const d = active - i;
      const p = eased(t, cues[active].time, PAST_DUR, P2_OUT);
      const from = pastTarget(d - 1);
      const to = pastTarget(d);
      const y = lerp(from.y, to.y, p);
      const sc = lerp(from.scale, to.scale, p);
      return {
        key: i,
        isHook,
        active: false,
        opacity: lerp(from.opacity, to.opacity, p),
        blur: lerp(from.blur, to.blur, p),
        transform: `translateY(${y}px) scale(${sc})`,
        words: words.map((w) => ({ chars: Array.from(w).map((ch) => ({ ch, cp: 1, opacity: 1, blur: 0 })), innerY: 0, hidden: false })),
      };
    }

    // ACTIVE
    const segs = getWordTimings(cue.text, cue.time, endTimeOf(cues, i));
    let act = -1;
    for (let k = 0; k < segs.length; k++) {
      if (t >= segs[k].start) act = k;
      else break;
    }
    const tIn = t - cue.time;
    const wipeFor = (wi: number, n: number): number[] =>
      wi < act ? Array(n).fill(1) : wi === act && segs[wi] ? charProgress(segs[wi], t, n) : Array(n).fill(0);

    if (isHook) {
      // INK-SOAK: line nét ngay, từng ký tự thấm vào (stagger toàn dòng). "love" ẩn tới khi hát.
      let k = 0; // chỉ số ký tự toàn cục (bỏ từ ẩn) cho stagger
      const wms: WordM[] = words.map((w, wi) => {
        const chars = Array.from(w);
        const cpArr = wipeFor(wi, chars.length);
        const held = normWord(w) === 'love';
        if (held) {
          const hs = segs[wi] ? segs[wi].start : cue.time;
          const hidden = t < hs;
          return {
            innerY: 0,
            hidden,
            chars: chars.map((ch, ci) => {
              const r = eased(t, hs, REVEAL_DUR, P2_OUT, REVEAL_STAGGER * ci);
              return { ch, cp: cpArr[ci], opacity: hidden ? 0 : lerp(0.04, 1, r), blur: hidden ? SOAK_BLUR : lerp(SOAK_BLUR, 0, r) };
            }),
          };
        }
        return {
          innerY: 0,
          hidden: false,
          chars: chars.map((ch, ci) => {
            const s = eased(t, cue.time, SOAK_DUR, P2_OUT, SOAK_STAGGER * k++);
            return { ch, cp: cpArr[ci], opacity: lerp(0.04, 1, s), blur: lerp(SOAK_BLUR, 0, s) };
          }),
        };
      });
      return { key: i, isHook, active: true, opacity: 1, blur: 0, transform: `translateY(0px) scale(${ACTIVE_SCALE})`, words: wms };
    }

    // ACTIVE thường: line fade/blur/scale + word-inner trượt lên (stagger), chars wipe màu.
    const e = eased(t, cue.time, ENTER_DUR, P2_OUT);
    const wms: WordM[] = words.map((w, wi) => {
      const chars = Array.from(w);
      const cpArr = wipeFor(wi, chars.length);
      const innerY = lerp(110, 0, eased(t, cue.time, INNER_DUR, P3_OUT, INNER_STAGGER * wi));
      return { innerY, hidden: false, chars: chars.map((ch, ci) => ({ ch, cp: cpArr[ci], opacity: 1, blur: 0 })) };
    });
    return {
      key: i,
      isHook,
      active: true,
      opacity: lerp(0, 1, e),
      blur: lerp(10, 0, e),
      transform: `translateY(${lerp(14, 0, e)}px) scale(${lerp(0.99, ACTIVE_SCALE, e)})`,
      words: wms,
    };
  });

  return (
    <AbsoluteFill
      className={`kt-root${hasVideo ? ' kt-has-video' : ''}`}
      style={{ '--au1': au1, '--au2': au2, '--accent': accent } as React.CSSProperties}
    >
      {hasVideo && (
        <Video
          className="kt-bgvideo"
          src={staticFile(bgVideo)}
          muted // nhạc là clip.mp3; video LUÔN tắt tiếng
          objectFit="cover" // @remotion/media: objectFit là prop riêng, không để trong style
          style={{ width: '100%', height: '100%', filter: 'brightness(0.92) saturate(1.06)' }}
        />
      )}
      <div className="kt-aurora">
        <div className="kt-au kt-au-a" />
        <div className="kt-au kt-au-b" />
      </div>
      {hasVideo && <div className="kt-scrim" />}
      <div className="kt-vignette" />
      <div className="kt-grain" />

      <div className="kt-stage">
        <div className="kt-flow" style={{ transform: `translateY(${scrollY}px)` }}>
          {models.map((m, i) => (
            <LineView key={m.key} m={m} refCb={refCbs[i]} />
          ))}
        </div>
      </div>

      <Audio src={staticFile('remain.flac')} />
    </AbsoluteFill>
  );
};
