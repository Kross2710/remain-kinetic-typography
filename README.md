# Remain — Kinetic Typography Lyric Player

Web player phát nhạc và animate lyrics theo thời gian thực, kiểu kinetic typography.
Bài demo: **"Remain" — Christian Kuria**. Giao diện **Aurora** (word-level, chữ tích tụ, đổi màu theo đoạn).

> **🌐 Bản deploy (GitHub Pages):** nền **video không kèm theo repo** (file quá nặng cho GitHub),
> nên trên site sẽ dùng **nền Aurora**. Bấm **"✨ Xem thử (không nhạc)"** để xem toàn bộ hiệu ứng.
> Muốn nền video: chạy local và thả `assets/video/bg.mp4` (xem `assets/video/README.txt`).

## ▶️ Chạy thử (không cần cài gì)

1. Mở thẳng `index.html` bằng trình duyệt (double-click), **hoặc** dùng panel *Launch preview*.
2. Bấm **"✨ Xem thử (không nhạc)"** → animation chạy ngay bằng đồng hồ ảo.
3. Có nhạc rồi? Thả file vào `assets/audio/clip.mp3` rồi bấm **"▶ Phát"**, hoặc bấm **"🎵 Chọn nhạc…"** để chọn file bất kỳ.

> Mẹo: vì lyrics được **nhúng sẵn** và GSAP để **local**, app chạy được cả khi mở bằng `file://` và khi offline.
> Khi mở bằng `file://`, một số trình duyệt chặn phát file ở `assets/audio/`; nếu vậy hãy dùng nút "Chọn nhạc…", hoặc chạy server tĩnh: `python3 -m http.server` rồi vào `http://localhost:8000`.

## 🎬 Effect đang có

| # | Effect | Khi nào |
|---|--------|---------|
| ① | **Masked word-rise** — chữ trượt lên qua khung che | khi vào một dòng (mặc định) |
| ② | **Active-word highlight** — dim cả dòng, sáng chữ đang hát (amber) | liên tục theo nhạc |
| ③ | **Exhale-out** — dòng cũ chìm xuống + mờ + hơi nhoè | khi rời một dòng |
| ⑥ | **Character cascade** — từng ký tự nảy lên | dành riêng câu hook "I will remain" |

Mọi hiệu ứng chỉ dùng `transform` + `opacity` (giữ 60fps). Chi tiết design/lý do: [docs/effects-and-build-plan.md](docs/effects-and-build-plan.md).

## 🗂️ Cấu trúc

```
index.html               # khung + nạp script (thứ tự quan trọng)
assets/audio/clip.mp3    # (bạn thả nhạc vào đây)
src/styles/main.css      # thẩm mỹ "ánh nến"
src/vendor/gsap.min.js   # GSAP 3.13 (local)
src/js/
  lrc-parser.js          # .lrc -> [{time, text}]
  word-timings.js        # chia thời lượng dòng cho từng chữ  ← THAY ở đây khi lên word-level
  clock.js               # đồng hồ: audio | virtual (xem thử)
  animations.js          # enter / exit / cascade (GSAP)
  lyrics.data.js         # LRC nhúng sẵn
  app.js                 # vòng lặp rAF + phát hiện đổi dòng + sự kiện audio
```

## 🧠 Kiến trúc cốt lõi

**"Audio làm đồng hồ, GSAP chỉ phản ứng."** `requestAnimationFrame` đọc `audio.currentTime` mỗi frame;
chỉ khi **dòng đổi** mới bắn một tween ngắn. Không có timeline dài chạy song song → **không trôi**,
và **seek** chỉ snap sang đúng dòng ở frame kế. Highlight từng chữ được tính lại mỗi frame → tự khắc seek-safe.

## 🎯 Tạo timestamp word-level (Hướng 3) — `editor.html`

Mở `editor.html` (qua server tĩnh, ví dụ `localhost:8123/editor.html`) để chấm mốc **từng chữ** bằng tay:

1. Bấm ▶ phát (để **0.75x** cho dễ), mỗi khi một chữ **bắt đầu** vang lên → gõ <kbd>Space</kbd> (TAP).
2. Sai thì <kbd>Backspace</kbd> (hoàn tác) hoặc **click một chữ** để chọn lại & tua nhạc tới đó.
3. Bật **"Lặp dòng"** để tap đi tap lại một dòng cho chuẩn.
4. Ô **"Bù tay (offset)"** mặc định `-0.12s` tự trừ độ trễ phản xạ tay — chỉnh nếu thấy lệch.
5. Tự lưu vào trình duyệt (localStorage). Xong bấm **Copy / ⬇ Enhanced LRC** hoặc **JSON** (định dạng `{word, start, end}`).

> Mẹo: chấm thô cả bài trước, rồi dùng "Lặp dòng" + 0.5x rà lại từng dòng. Export khi đã chấm hết
> (chữ chưa chấm sẽ nhận tạm timestamp đầu dòng / `null`).

### Cắm kết quả vào player
Sau khi có JSON word-level, chỉ cần sửa `src/js/word-timings.js`: `getWordTimings()` trả về
`{ word, start, end }` lấy từ timestamp thật thay vì chia đều. **Animation & vòng lặp sync KHÔNG đổi.**
(Thay thế tự động hay forced-alignment WhisperX/aeneas + Demucs là phương án còn lại cho nhiều bài.)

## 🐞 Debug

Trong console: `KT.debug.renderAt(45)` để hiển thị đứng yên khung lyric tại giây 45. `KT.debug.cues` xem toàn bộ cue.
