# Export — xuất video (local, frame-by-frame)

Render animation kinetic-typography (chữ + nền video + nhạc) ra **MP4 1080p** ở 2 tỉ lệ:
**16:9** (YouTube) và **9:16** (TikTok/Reels/Shorts). Tất định, khớp frame tuyệt đối — KHÔNG quay màn hình real-time.

## Cách chạy

1. **Cài deps** (1 lần): `npm i` trong thư mục này. Cần `ffmpeg`/`ffprobe` trong PATH (`brew install ffmpeg`) và Google **Chrome** (không phải Chromium — H.264).
   (Script TỰ chạy server tĩnh có hỗ trợ Range ở cổng 8124 — KHÔNG dùng `python -m http.server` vì nó không hỗ trợ Range → `<video>` không seek được → nền đứng hình.)
3. **Tạo video nền all-intra** (1 lần, để seek đúng frame). Mỗi frame là keyframe nên tua chính xác:
   ```bash
   # 16:9 (từ bản ngang)
   ffmpeg -y -i ../assets/video/bg-web-desktop.mp4 -an \
     -c:v libx264 -x264-params keyint=1:min-keyint=1:scenecut=0 -preset veryfast -crf 20 \
     -pix_fmt yuv420p -movflags +faststart ../assets/video/bg-allkey-16x9.mp4
   # 9:16 (từ bản gốc dọc, cắt ~200s)
   ffmpeg -y -i ../assets/video/bg.mp4 -an -t 200 \
     -c:v libx264 -x264-params keyint=1:min-keyint=1:scenecut=0 -preset veryfast -crf 20 \
     -pix_fmt yuv420p -movflags +faststart ../assets/video/bg-allkey-9x16.mp4
   ```
4. **Render:**
   ```bash
   node capture.mjs 16:9 --q 720 --fps 30 --seconds 12   # thử nhanh nghiệm thu (~12s đầu)
   node capture.mjs both                                  # final 1080p60 cả hai tỉ lệ
   ```
   Cờ: `--q 1080|720` (cạnh ngắn) · `--fps 30|60` · `--seconds N` (giới hạn để test).

Kết quả ở `out/remain_16x9_1080p60.mp4`, `out/remain_9x16_1080p60.mp4`.

## Hoạt động thế nào

- `KT.render` (trong `src/js/app.js`) giành quyền điều khiển ticker GSAP (`gsap.ticker.remove(gsap.updateRoot)`),
  mỗi frame gọi `gsap.updateRoot(t)` → mọi tween (vào dòng, cuộn, scale, lerp màu aurora) chạy đúng theo
  thời gian frame, không phụ thuộc đồng hồ thực.
- Nền `<video>` được tua từng frame và chờ paint bằng `requestVideoFrameCallback` (gate `mediaTime >= t`).
- Chrome/nút điều khiển/thanh tiến trình bị ẩn khi render → video sạch (chỉ chữ + nền).
- PNG từng frame pipe thẳng vào `ffmpeg` (image2pipe), ghép `clip.mp3`, xuất H.264 yuv420p CRF18 + AAC.

## Lưu ý

- File `assets/video/bg-allkey-*.mp4` (all-intra, ~240MB mỗi cái) và `out/` đều **không commit** (xem `.gitignore`).
- Render 1080p60 ~195s ≈ 11.700 frame/bản → khá lâu (vài chục phút). Chạy nền được.
- **Bản quyền:** video xuất ra chứa nhạc "Remain" (Christian Kuria) + footage *Fallen Angels* → đăng công khai có thể dính Content-ID.
