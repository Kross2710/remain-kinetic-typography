// capture.mjs — render kinetic-typography frame-by-frame (tất định) -> MP4, hoặc SEGMENT video-only (cho đa lõi).
//
// Pipeline: headless Google Chrome mở site (server riêng có Range, cổng tự do) -> KT.render.begin() giành
// quyền điều khiển GSAP (manual ticker) -> mỗi frame KT.render.seek(t) (đẩy GSAP + tua <video> tới frame t)
// -> chụp PNG -> pipe vào ffmpeg -> ghép nhạc -> MP4. Segment mode: chỉ video, kèm WARMUP để liền mạch.
//
// Cờ:
//   <aspect>                        16:9 | 9:16 | both
//   --q <1080|720>                  cạnh ngắn
//   --fps <60|30>
//   --audio <path>                  nhạc để ghép (mặc định assets/audio/clip.mp3)
//   --start <s> --seconds <s>       render 1 cửa sổ (test/clip)
//   --fromframe <i> --toframe <j>   render khúc frame [i, j) (cho chia khúc đa lõi)
//   --warm <s>                      số giây "khởi động" trước fromframe để dựng đúng trạng thái (mặc định 3)
//   --segout <path>                 xuất SEGMENT video-only (không ghép nhạc) — để concat sau

import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, createReadStream, statSync } from 'node:fs';
import { dirname, resolve, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let URL_BASE = '';

// ---------- args ----------
const argv = process.argv.slice(2);
// Nếu token sau --x lại là một cờ khác (hoặc thiếu) -> coi như KHÔNG truyền giá trị (tránh nuốt nhầm '--fps' làm value).
const flag = (n, d) => { const i = argv.indexOf('--' + n); if (i < 0) return d; const v = argv[i + 1]; return (v === undefined || v.startsWith('--')) ? d : v; };
const has = (n) => argv.includes('--' + n);
const aspectArg = argv.find((a) => a === '16:9' || a === '9:16' || a === 'both') || 'both';
const Q = parseInt(flag('q', '1080'), 10);
const FPS = parseInt(flag('fps', '60'), 10);
if (!Number.isFinite(Q) || !Number.isFinite(FPS)) {
  console.error('Tham số không hợp lệ: --q và --fps cần là SỐ. VD: node capture.mjs both --q 1080 --fps 60');
  process.exit(1);
}
const AUDIO = resolve(flag('audio', resolve(PROJECT, 'assets/audio/clip.mp3')));
const START = parseFloat(flag('start', '0')) || 0;
const SECONDS = flag('seconds', null);
const FROMFRAME = has('fromframe') ? parseInt(flag('fromframe'), 10) : null;
const TOFRAME = has('toframe') ? parseInt(flag('toframe'), 10) : null;
const WARM = parseFloat(flag('warm', '3')) || 0;
const SEGOUT = flag('segout', null);
const HW = has('hw');                                  // encode bằng Media Engine của Apple Silicon (h264_videotoolbox)
const VBITRATE = flag('vb', Q >= 1080 ? '16M' : '8M'); // VideoToolbox không có CRF -> dùng bitrate mục tiêu

const even = (n) => { n = Math.round(n); return n % 2 ? n + 1 : n; };
function cfgFor(aspect) {
  const vertical = aspect === '9:16';
  const W = vertical ? even(Q) : even((Q * 16) / 9);
  const H = vertical ? even((Q * 16) / 9) : even(Q);
  return {
    aspect, vertical, W, H,
    videoSrc: vertical ? 'assets/video/bg-allkey-9x16.mp4' : 'assets/video/bg-allkey-16x9.mp4',
    out: resolve(__dirname, 'out', `remain_${vertical ? '9x16' : '16x9'}_${Q}p${FPS}.mp4`),
  };
}
function audioDuration() {
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', AUDIO]).toString().trim());
}

// ffmpeg: full (ghép nhạc) hoặc segment (video-only).
function buildFfmpeg(outPath, segment) {
  const a = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];   // -framerate là input-opt -> TRƯỚC -i
  if (!segment) a.push('-i', AUDIO);
  if (HW) a.push('-c:v', 'h264_videotoolbox', '-b:v', VBITRATE, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS));
  else a.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS));
  if (segment) a.push('-an');
  else a.push('-map', '0:v:0', '-map', '1:a:0', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest');
  a.push(outPath);
  return spawn('ffmpeg', a, { stdio: ['pipe', 'inherit', 'inherit'] });
}

// ---------- static server CÓ Range (bắt buộc để <video> seek; cổng tự do để chạy nhiều tiến trình) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
function startServer(root) {
  root = resolve(root);
  return new Promise((res, rej) => {
    const server = http.createServer((req, resp) => {
      try {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/' || p.endsWith('/')) p += 'index.html';
        const file = normalize(join(root, p));
        if (!file.startsWith(root)) { resp.writeHead(403); return resp.end(); }
        const st = statSync(file);
        const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
          let s = m[1] ? parseInt(m[1], 10) : 0, e = m[2] ? parseInt(m[2], 10) : st.size - 1;
          if (!(s >= 0)) s = 0; if (!(e < st.size)) e = st.size - 1;
          resp.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
          if (req.method === 'HEAD') return resp.end();
          createReadStream(file, { start: s, end: e }).pipe(resp);
        } else {
          resp.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
          if (req.method === 'HEAD') return resp.end();
          createReadStream(file).pipe(resp);
        }
      } catch (e) { resp.writeHead(404); resp.end(); }
    });
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => res(server));   // cổng 0 = OS tự cấp cổng trống
  });
}

async function renderAspect(browser, cfg, total) {
  const startFrame = FROMFRAME != null ? FROMFRAME : (START ? Math.round(START * FPS) : 0);
  let endFrame = TOFRAME != null ? TOFRAME : (SECONDS ? startFrame + Math.ceil(parseFloat(SECONDS) * FPS) : total);
  if (endFrame > total) endFrame = total;
  const nFrames = endFrame - startFrame;
  const warmFrames = Math.min(startFrame, Math.round(WARM * FPS));
  const outPath = SEGOUT ? resolve(SEGOUT) : cfg.out;
  const tag = SEGOUT ? `${cfg.aspect}[${startFrame}-${endFrame})` : cfg.aspect;
  console.log(`\n=== ${tag}  ${cfg.W}x${cfg.H} ${FPS}fps  warm ${warmFrames}f  ${nFrames} frames -> ${outPath}`);

  const page = await browser.newPage();
  await page.setViewport({ width: cfg.W, height: cfg.H, deviceScaleFactor: 1 });
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });        // KHÔNG networkidle0 (media stream giữ kết nối)
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate((o) => window.KT.render.begin(o), { aspect: cfg.aspect, videoSrc: cfg.videoSrc });

  // WARMUP: dựng trạng thái animation từ (startFrame-warmFrames) tới startFrame (không chụp, không tua video)
  for (let fi = startFrame - warmFrames; fi < startFrame; fi++) {
    await page.evaluate((t) => window.KT.render.step(t), fi / FPS);
  }

  const ff = buildFfmpeg(outPath, !!SEGOUT);
  let broken = false, ffErr = null;
  const ffDone = new Promise((res) => {
    ff.on('error', (e) => { broken = true; ffErr = ffErr || e; res(); });
    ff.on('close', (c) => { if (c !== 0) { broken = true; ffErr = ffErr || new Error('ffmpeg exit ' + c); } res(); });
  });
  ff.stdin.on('error', (e) => { broken = true; if (e.code !== 'EPIPE') ffErr = ffErr || e; });

  const clip = { x: 0, y: 0, width: cfg.W, height: cfg.H };
  const t0 = Date.now();
  let wrote = 0;
  try {
    for (let fi = startFrame; fi < endFrame; fi++) {
      if (broken) break;
      await page.evaluate((t) => window.KT.render.seek(t), fi / FPS);   // resolve khi đã PAINT
      const buf = await page.screenshot({ type: 'png', optimizeForSpeed: true, clip, captureBeyondViewport: false });
      if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');           // backpressure
      wrote++;
      if (wrote % 300 === 0 || fi === endFrame - 1) {
        const rfps = wrote / ((Date.now() - t0) / 1000);
        const eta = ((nFrames - wrote) / Math.max(rfps, 0.01) / 60).toFixed(1);
        console.log(`[${tag}] ${wrote}/${nFrames} (${(wrote / nFrames * 100).toFixed(1)}%)  ${rfps.toFixed(1)} fps  ETA ${eta}m`);
      }
    }
  } finally {
    try { ff.stdin.end(); } catch (e) {}
  }
  await ffDone;
  if (ffErr) throw ffErr;
  if (wrote < nFrames) throw new Error(`TRUNCATED ${tag}: ${wrote}/${nFrames} frame (broken=${broken}) — KHÔNG giao file thiếu`);
  try { await page.evaluate(() => window.KT.render.end()); } catch (e) {}
  await page.close();
  console.log(`    DONE -> ${outPath} (${wrote} frames)`);
}

(async () => {
  mkdirSync(resolve(__dirname, 'out'), { recursive: true });
  const total = Math.ceil(audioDuration() * FPS);
  const aspects = aspectArg === 'both' ? ['16:9', '9:16'] : [aspectArg];

  const server = await startServer(PROJECT);
  URL_BASE = `http://127.0.0.1:${server.address().port}/`;
  console.log(`serving (Range) ${URL_BASE}  audio=${AUDIO}  total=${total}f`);

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 1_200_000, defaultViewport: null,
    args: [
      '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--hide-scrollbars',
      '--font-render-hinting=none', '--disable-lcd-text', '--disable-font-subpixel-positioning', '--mute-audio',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-first-run',
    ],
  });
  try {
    for (const a of aspects) await renderAspect(browser, cfgFor(a), total);   // tuần tự trong 1 tiến trình
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nAll done.');
})().catch((e) => { console.error(e); process.exit(1); });
