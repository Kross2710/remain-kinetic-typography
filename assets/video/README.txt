Video nền — bản web nhẹ (H.264, faststart) commit lên repo, player TỰ CHỌN theo màn hình:
  • bg-web-desktop.mp4 — NGANG 16:9 (1920x1080) -> desktop/tablet (bề ngang >= 768px)
  • bg-web.mp4         — DỌC 9:16 (304x540)    -> điện thoại (bề ngang < 768px)
Player đổi nguồn theo matchMedia('(min-width: 768px)') + đồng bộ video theo thời gian bài.
Thiếu file desktop -> tự lùi về bg-web.mp4; thiếu nốt -> chạy nền Aurora.

Tạo bản web từ video gốc (KHÔNG cần ffmpeg — avconvert có sẵn trên macOS):
  avconvert -s GOC.mp4 -p Preset1920x1080 -o bg-web-desktop.mp4 --duration 197 --replace
  (lưu ý: preset downscale như 1280x720 lại TĂNG bitrate -> file to hơn; giữ 1920x1080 gần passthrough, nhẹ nhất)

- Bản gốc bg.mp4 (~307MB) giữ ở LOCAL, KHÔNG commit (xem .gitignore).
- Trim ~197s để khớp độ dài bài (~3:15). Chạy muted (không cần tiếng).
- Trong app bấm "🎬 Video…" để chọn file bất kỳ (sẽ NGỪNG auto đổi theo màn hình).
