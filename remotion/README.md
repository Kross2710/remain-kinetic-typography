# Remain — bản Remotion (thử nghiệm)

Skeleton **song song**, KHÔNG thay thế app vanilla ở thư mục gốc. Mục đích: xem thử cảm giác
khi dựng kinetic-typography bằng Remotion (React + render frame tất định + ffmpeg) — đúng cơ chế
mà `export/capture.mjs` đang tự làm thủ công, nhưng có sẵn multi-core, preview Studio, `<OffthreadVideo>`…

## Chạy

```bash
cd remotion
npm install          # lần đầu (tải Remotion + Chromium headless, hơi lâu)
npm run dev          # mở Remotion Studio để xem/scrub realtime
```

Xuất video:
```bash
npm run render            # 16:9 -> out/remain-16x9.mp4 (x264, 4 lõi)
npm run render:vertical   # 9:16 -> out/remain-9x16.mp4
npm run render:hw         # thử Media Engine (VideoToolbox) nếu muốn nhanh hơn
```

## Đã port (tái dùng nguyên vẹn)

| Phần | Nguồn gốc | File ở đây |
|---|---|---|
| Parse LRC | `src/js/lrc-parser.js` | `src/lib/lrc.ts` |
| Word-level timing | `src/js/word-timings.js` | `src/lib/wordTimings.ts` |
| Cấu trúc đoạn + palette | `src/js/sections.js` | `src/lib/sections.ts` |
| Dữ liệu LRC / word / emphasis | `src/js/*.data.js` | `src/data/*.ts` (auto-generated) |
| Karaoke wipe `--cp` (color-mix, KHÔNG bg-clip) | `aurora.css` + `app.js` | `src/style.css` + `RemainLyrics.tsx` |
| Nền aurora / grain / vignette | `aurora.css` | `src/style.css` |

> Dữ liệu trong `src/data/` được **sinh tự động** từ `src/js/*.data.js` (xem lệnh trong báo cáo).
> Nguồn chân lý vẫn là file gốc — chấm lại timing thì sinh lại, đừng sửa tay.

## Hiệu ứng đã port (đối chiếu parity với vanilla)

- Enter dòng thường: line fade/y/scale/blur (1.25s, power2.out) + word-inner trượt lên qua mask (stagger).
- Ink-soak dòng hook (Instrument Serif italic) + từ "love" ẩn tới khi hát rồi thấm vào.
- toPast: exhale-out (nhích lên −14, co 0.9, mờ + nhòe theo khoảng cách).
- Cuộn recenter mượt đo offset thật (1.35s power2.out), câu mở đầu cuộn vào tâm, clear màn hình cuối bài.
- Karaoke wipe per-char (color-mix theo --cp, KHÔNG bg-clip) + aurora lerp màu 2.6s sine.inOut.
- **Nền video** qua `<OffthreadVideo muted>` (frame-accurate, không cần `seekVideoToFrame` thủ công).

> Easing GSAP map sang Remotion: power2=Cubic.out, power3=Quart.out, sine.inOut. Xem `src/lib/anim.ts`.

## Đổi / tắt video nền (không cần sửa code)

`bgVideo` là **prop có schema** → mở Studio (`npm run dev`), panel bên phải có ô **bgVideo**:
- Nhập tên file (đặt trong `public/`) để đổi video.
- **Để rỗng** = chỉ dùng nền aurora.
- Video **luôn muted** (mute là prop trong code, không có nút riêng — nhạc là `clip.mp3`).

## Còn lại (tùy chọn, chưa làm vì vanilla cũng không có/không cần)

- Spring easing của GSAP cho lần *seek lùi* (forward playback không thấy nên dùng power2.out là khớp).
- `emphasis` (`is-emph`) — vanilla gắn class nhưng KHÔNG có CSS (no-op), nên ở đây cũng không thêm hiệu ứng.

## Nếu muốn tiến tiếp

`@remotion/player` (`<Player>`) có thể nhúng đúng `RemainLyrics` vào web như player tương tác
(play/pause/seek) → gộp **player live + export** về một codebase React duy nhất.
