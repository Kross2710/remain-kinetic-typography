// Port từ src/js/word-timings.js — timing từng chữ cho 1 dòng.
// Ưu tiên WORD_DATA (mốc thật, khớp theo text + lineStart gần nhất), fallback chia theo trọng số ký tự.
import { WORD_DATA, WordLine } from '../data/words';

export type Seg = { word: string; start: number; end: number };

const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

let _index: Map<string, WordLine[]> | null = null;
function buildIndex() {
  _index = new Map();
  for (const line of WORD_DATA) {
    const key = norm(line.words.map((w) => w.word).join(' '));
    if (!_index.has(key)) _index.set(key, []);
    _index.get(key)!.push(line);
  }
}

function lookup(text: string, lineStart: number): WordLine | null {
  if (!WORD_DATA.length) return null;
  if (!_index) buildIndex();
  const cands = _index!.get(norm(text));
  if (!cands || !cands.length) return null;
  let best = cands[0];
  let bestD = Infinity;
  for (const c of cands) {
    const base = c.words[0] && c.words[0].start != null ? c.words[0].start : c.lineStart;
    const d = Math.abs(base - lineStart);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function sanitize(words: Seg[], lineEnd: number): Seg[] {
  let prev = -Infinity;
  const out = words.map((w) => {
    let start = w.start != null ? w.start : prev;
    if (start < prev) start = prev;
    prev = start;
    let end = w.end != null ? w.end : start;
    if (end < start) end = start;
    return { word: w.word, start, end };
  });
  if (out.length && lineEnd != null && out[out.length - 1].end > lineEnd + 2) {
    out[out.length - 1].end = lineEnd;
  }
  return out;
}

export function getWordTimings(text: string, lineStart: number, lineEnd: number): Seg[] {
  const hit = lookup(text, lineStart);
  if (hit) return sanitize(hit.words, lineEnd);

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const total = Math.max(0.001, lineEnd - lineStart);
  const weights = words.map((w) => w.length + 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = lineStart;
  return words.map((w, i) => {
    const dur = (weights[i] / sum) * total;
    const seg = { word: w, start: acc, end: acc + dur };
    acc += dur;
    return seg;
  });
}
