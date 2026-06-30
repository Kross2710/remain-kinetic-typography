// render-fast.mjs — render ĐA LÕI: chia mỗi tỉ lệ thành nhiều khúc, chạy song song nhiều tiến trình
// (mỗi tiến trình là 1 capture.mjs riêng -> 1 browser + 1 server cổng tự do), rồi concat + ghép nhạc.
//
// Dùng: node render-fast.mjs [both|16:9|9:16] [--workers 8] [--q 1080] [--fps 60] [--audio <path>] [--warm 3]
// Mỗi khúc warmup `warm` giây trước điểm bắt đầu để dựng đúng trạng thái animation -> chỗ nối liền mạch.

import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '..');
const CAP = resolve(__dirname, 'capture.mjs');
const OUT = resolve(__dirname, 'out');
const SEG = resolve(OUT, 'seg');

const argv = process.argv.slice(2);
// Nếu token sau --x lại là một cờ khác (hoặc thiếu) -> coi như KHÔNG truyền giá trị (tránh nuốt nhầm '--fps' làm value).
const flag = (n, d) => { const i = argv.indexOf('--' + n); if (i < 0) return d; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? d : v; };
const aspectArg = argv.find((a) => a === '16:9' || a === '9:16' || a === 'both') || 'both';
// Mặc định = số lõi PERFORMANCE (đo thực: vượt quá -> Chrome + x264 giành lõi, throughput TỤT mạnh).
// Apple Silicon: hw.perflevel0.physicalcpu = số P-core; fallback nửa số lõi logic cho máy khác.
function defaultWorkers() {
  try { const n = parseInt(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu']).toString().trim(), 10); if (n > 0) return n; } catch (e) {}
  try { return Math.max(2, Math.floor(os.cpus().length / 2)); } catch (e) {}
  return 4;
}
const WORKERS = parseInt(flag('workers', String(defaultWorkers())), 10);
const Q = flag('q', '1080');
const FPS = parseInt(flag('fps', '60'), 10);
const WARM = flag('warm', '3');
if (!Number.isFinite(parseInt(Q, 10)) || !Number.isFinite(FPS)) {
  console.error('Tham số không hợp lệ: --q và --fps cần là SỐ. VD: node render-fast.mjs both --q 1080 --fps 60');
  process.exit(1);
}
const HW = argv.includes('--hw');                    // encode khúc bằng Media Engine M-series
const VB = flag('vb', null);
const AUDIO = resolve(flag('audio', resolve(PROJECT, 'assets/audio/clip.mp3')));
const aspects = aspectArg === 'both' ? ['16:9', '9:16'] : [aspectArg];
const tagOf = (a) => (a === '9:16' ? '9x16' : '16x9');

function audioDuration() {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', AUDIO]).toString().trim());
}
function chunkRanges(total, n) {
  const size = Math.ceil(total / n);
  const r = [];
  for (let s = 0; s < total; s += size) r.push([s, Math.min(s + size, total)]);
  return r;
}
function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('error', rej);
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`exit ${c}: ${cmd} ${args.join(' ')}`))));
  });
}
async function pool(tasks, limit) {           // chạy tối đa `limit` task song song
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) { const idx = i++; await tasks[idx](); }
  });
  await Promise.all(workers);
}

(async () => {
  const total = Math.ceil(audioDuration() * FPS);
  const chunksPerAspect = Math.max(1, Math.round(WORKERS / aspects.length));
  mkdirSync(SEG, { recursive: true });

  const plan = {};       // aspect -> [segPath...]
  const jobs = [];
  for (const aspect of aspects) {
    const ta = tagOf(aspect);
    plan[aspect] = [];
    chunkRanges(total, chunksPerAspect).forEach(([from, to], ci) => {
      const segPath = resolve(SEG, `${ta}_${String(ci).padStart(2, '0')}.mp4`);
      plan[aspect].push(segPath);
      const extra = [];
      if (HW) extra.push('--hw');
      if (VB) extra.push('--vb', String(VB));
      jobs.push(() => run('node', [CAP, aspect, '--q', String(Q), '--fps', String(FPS), '--warm', String(WARM),
        '--fromframe', String(from), '--toframe', String(to), '--segout', segPath, '--audio', AUDIO, ...extra]));
    });
  }
  console.log(`total ${total}f · ${aspects.length} tỉ lệ × ${chunksPerAspect} khúc = ${jobs.length} job · ${WORKERS} song song`);
  await pool(jobs, WORKERS);

  // concat các khúc (copy, không re-encode) + ghép nhạc cho từng tỉ lệ
  for (const aspect of aspects) {
    const ta = tagOf(aspect);
    const listPath = resolve(SEG, `list_${ta}.txt`);
    writeFileSync(listPath, plan[aspect].map((p) => `file '${p}'`).join('\n') + '\n');
    const finalOut = resolve(OUT, `remain_${ta}_${Q}p${FPS}.mp4`);
    console.log(`concat + audio -> ${finalOut}`);
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-i', AUDIO,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', finalOut]);
  }
  rmSync(SEG, { recursive: true, force: true });
  console.log('\nALL DONE (multi-core).');
})().catch((e) => { console.error(e); process.exit(1); });
