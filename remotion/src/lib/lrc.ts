// Port nguyên văn từ src/js/lrc-parser.js — parse .lrc -> cue[] đã sort theo thời gian.
export type Cue = { time: number; text: string };

export function parseLRC(raw: string): Cue[] {
  const lines = raw.split(/\r?\n/);
  const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const cues: Cue[] = [];

  for (const line of lines) {
    const text = line.replace(timeTag, '').trim();
    timeTag.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = timeTag.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      let frac = 0;
      if (m[3] != null) frac = parseInt(m[3], 10) / Math.pow(10, m[3].length);
      cues.push({ time: min * 60 + sec + frac, text });
    }
  }
  cues.sort((a, b) => a.time - b.time);
  return cues;
}
