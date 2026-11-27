# Export — xuất video (local, frame-by-frame)

Render animation kinetic-typography (chữ + nền video + nhạc) ra **MP4 1080p** ở 2 tỉ lệ:
**16:9** (YouTube) và **9:16** (TikTok/Reels/Shorts). Tất định, khớp frame tuyệt đối — KHÔNG quay màn hình real-time.

## Cách chạy

1. **Cài deps** (1 lần): `npm i` trong thư mục này. Cần `ffmpeg`/`ffprobe` trong PATH (macOS: `brew install ffmpeg` · Linux/Debian: `sudo apt install ffmpeg`) và Google **Chrome** (không phải Chromium — để có H.264). Script **tự dò Chrome** theo nền tảng (macOS: `/Applications/Google Chrome.app/...` · Linux: `/usr/bin/google-chrome-stable`); ghi đè bằng `CHROME_PATH=<đường dẫn>` nếu cần.
   (Script TỰ chạy server tĩnh có hỗ trợ Range ở **cổng động** do OS cấp — KHÔNG dùng `python -m http.server` vì nó không hỗ trợ Range → `<video>` không seek được → nền đứng hình.)
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
   Cờ: `--q 1080|720` (cạnh ngắn) · `--fps 30|60` · `--seconds N` (giới hạn để test) · `--hw` (encode bằng GPU của máy đang chạy) · `--gpu` (Chrome **vẽ** bằng iGPU).
   `--hw` **tự chọn encoder theo thiết bị**: macOS → `h264_videotoolbox` · Linux/Intel-AMD (có `/dev/dri/renderD128`) → `h264_vaapi` · NVIDIA → `h264_nvenc`. Ghi đè: `HW_ENCODER=vaapi|videotoolbox|nvenc|x264`, `VAAPI_DEVICE=/dev/dri/renderD128`.
   `--gpu` bật `--use-gl=angle --use-angle=vulkan` (ANGLE → Mesa/Intel, trên N100 là `Intel(R) Graphics (ADL-N)`) **kèm `--disable-accelerated-video-decode`**. Bắt buộc phải tắt decode video bằng GPU: nếu để iGPU decode `<video>` nền, screenshot trả về khung **đen** (đo: YAVG 20 thay vì 50). Đo trên N100 (16:9 720p30, 180 khung hình, encode `--hw` như nhau): SwiftShader 72.2/73.8s = 2.5–2.6 fps → iGPU 52.8/54.5s = **3.4–3.5 fps** (+31%), PSNR so với bản SwiftShader 47 dB (gần như giống hẳn, khác chỉ ở antialias chữ).
   Ghi đè backend GL bằng `CHROME_EXTRA_ARGS="--use-angle=gl-egl"` (OpenGL ES 3.2, cũng 3.4 fps). Mặc định **không** bật `--gpu` — vẫn SwiftShader để giữ đúng chất lượng chữ.
   **Render đa lõi** (chia timeline thành khúc, chạy song song theo số lõi, ghép lại): `node render-fast.mjs both --hw --gpu` (worker = số lõi; macOS đếm P-core, Linux đếm lõi qua `lscpu`).

Kết quả ở `out/remain_16x9_1080p60.mp4`, `out/remain_9x16_1080p60.mp4`.

## Hoạt động thế nào

- `KT.render` (trong `src/js/app.js`) giành quyền điều khiển ticker GSAP (`gsap.ticker.remove(gsap.updateRoot)`),
  mỗi frame gọi `gsap.updateRoot(t)` → mọi tween (vào dòng, cuộn, scale, lerp màu aurora) chạy đúng theo
  thời gian frame, không phụ thuộc đồng hồ thực.
- Nền `<video>` được tua từng frame và chờ paint bằng `requestVideoFrameCallback` (gate `mediaTime >= t`).
- Chrome/nút điều khiển/thanh tiến trình bị ẩn khi render → video sạch (chỉ chữ + nền).
- PNG từng frame pipe thẳng vào `ffmpeg` (image2pipe), ghép `clip.mp3`, xuất H.264 yuv420p CRF18 + AAC.

## Lưu ý

- File `assets/video/bg-allkey-*.mp4` (all-intra, ~240MB mỗi cái) và `out/` đều **không commit** (xem `.gitignore`). Nếu chưa tạo bản all-intra, `capture.mjs` **tự fallback** sang bản web nhẹ có sẵn (`bg-web-desktop.mp4` / `bg-web.mp4`) — vẫn chạy, chỉ seek kém chính xác hơn chút.
- Render 1080p60 ~195s ≈ 11.700 frame/bản → khá lâu (vài chục phút). Chạy nền được.
- **Bản quyền:** video xuất ra chứa nhạc "Remain" (Christian Kuria) + footage *Fallen Angels* → đăng công khai có thể dính Content-ID.
