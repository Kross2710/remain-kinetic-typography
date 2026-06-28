---
title: Spotify Kinetic Typography Web Player
aliases:
  - Kinetic Typography Player
  - Lyric Animation Player
tags:
  - project
  - idea
  - web
  - animation
  - gsap
status: planning
created: 2026-06-28
updated: 2026-06-28
---

# 🎵 Spotify Kinetic Typography Web Player

> [!abstract] Một câu tóm tắt
> Web app phát một đoạn nhạc và animate lyrics theo thời gian thực, mô phỏng phong cách **kinetic typography / video editing** (Premiere, CapCut): chữ pop, slide, glitch, beat shake — đồng bộ chính xác với audio.

---

## 1. Mục tiêu (Goal)

Xây dựng web app:
- Phát một audio track.
- Đồng bộ animation lyrics **theo từng chữ** (word-level) với timeline của bài hát.
- Hiệu ứng kiểu video editor: zoom-in, fade, slide, glitch, beat shake...
- Giữ **60fps+** mượt mà.

> [!note] Về cái tên "Spotify"
> Đây chỉ là tên gợi cảm hứng. **Không** stream trực tiếp từ Spotify (DRM + ToS cấm sync kiểu này, API chỉ trả 30s preview). Dùng file nhạc royalty-free / tự tạo. Cân nhắc đổi tên dự án để tránh hiểu nhầm pháp lý.

---

## 2. Kiến trúc & Tech stack

| Lớp | Công nghệ | Ghi chú |
|-----|-----------|---------|
| **Frontend** | HTML5, SCSS, JavaScript (vanilla hoặc framework nhẹ) | Bắt đầu vanilla cho MVP |
| **Audio & Timeline** | HTML5 `<audio>` + `audio.currentTime` đọc qua `requestAnimationFrame` | `timeupdate` quá thưa (~4 lần/s) → dùng `rAF` ~60fps |
| **Lyric data** | `.lrc` parse thành JSON | Xem mục [Định dạng dữ liệu](#5-định-dạng-dữ-liệu-lyric) |
| **Animation engine** | **GSAP** (`gsap.timeline()`) + **SplitText** | GSAP 3.13+ giờ miễn phí cả commercial, gồm **SplitText** → không cần Splitting.js nữa (Splitting.js chỉ là fallback) |
| **Performance** | Chỉ animate `transform` (translate/scale/rotate) + `opacity` | Chạy thẳng trên GPU compositor, không reflow/repaint |

### Vòng lặp sync cốt lõi
1. `rAF` loop đọc `audio.currentTime` (nguồn chân lý — source of truth).
2. Xác định dòng lyric hiện tại theo timestamp.
3. Khi sang dòng/chữ mới → bắn GSAP animation.
4. Xử lý **seek** (tua): nhảy đúng vị trí, reset animation, không để trôi (drift).

> [!tip] Vì sao không bị drift
> Mỗi frame đều **đọc lại** `audio.currentTime` thay vì tự cộng dồn thời gian → sai số không tích lũy.

---

## 3. ⭐ Quyết định: Animation theo từng chữ (Hướng 3 — Word-level)

Đã cân nhắc 3 hướng để có timing cho từng chữ. **Đã chọn Hướng 3.**

| Hướng | Cách làm | Khớp nhịp hát | Công chuẩn bị data |
|-------|----------|:---:|---|
| H1 — Chia đều (stagger) | Lấy duration dòng = `(ts dòng sau) − (ts dòng này)`, GSAP `stagger` rải đều các chữ | ~80% | Không cần gì (dùng LRC line-level) |
| H2 — Theo trọng số | Như H1 nhưng chia theo số ký tự/âm tiết | ~88% | Vài dòng code |
| **H3 — Word-level LRC (Enhanced/A2)** ✅ | **Mỗi chữ có timestamp riêng** | **100% (chuẩn karaoke)** | **Phải chấm/align từng chữ** |

### Enhanced LRC trông như thế nào
```
[00:16.31] <00:16.31>You've <00:16.74>been <00:17.10>living <00:17.65>like ...
```
→ Hiệu ứng "sáng/animate từng chữ theo đúng giọng hát" như Apple Music.

> [!warning] Chi phí của Hướng 3
> Cần data word-level. Hai cách tạo:
> - **Thủ công:** chấm mốc từng chữ bằng LRC editor — chính xác nhưng tốn công.
> - **Forced alignment (tự động):** dùng tool căn text vào audio:
>   - `aeneas` (Python, forced alignment)
>   - **Whisper** (`whisper` / `whisperX`) — transcribe + word-level timestamps
>   - `Montreal Forced Aligner (MFA)`
>   → Máy tự sinh timestamp từng chữ, sau đó tinh chỉnh lại bằng tay.

> [!tip] Kiến trúc nên tách timing khỏi animation
> Viết một hàm `getWordTimings(line)` riêng. Dù dùng H1, H2 hay H3, phần animation **không đổi** — chỉ thay nguồn timing. Cho phép bắt đầu bằng H1 để chạy thử, rồi nâng lên H3 mà không viết lại engine.

---

## 4. Cách lấy file nhạc & lyrics

### 4.1. File nhạc 🎵
| Nguồn | An toàn pháp lý |
|-------|-----------------|
| Royalty-free / CC (Pixabay Music, Free Music Archive, YouTube Audio Library, Incompetech) | ✅ Tốt nhất cho demo |
| Nhạc tự sản xuất / của bạn bè | ✅ An toàn tuyệt đối |
| File mp3 cá nhân đã mua (chỉ local, không deploy) | ⚠️ OK cá nhân |
| Spotify / Apple Music (stream DRM) | ❌ Không lấy được file |

→ Đặt vào `assets/audio/clip.mp3`.

### 4.2. Lyrics có timeline (.lrc) ⏱️
- **Tự gõ tay** — nhanh nhất cho đoạn ngắn.
- **Tap-sync tool** — lrcget, Lrcify, LRC editor online (play nhạc, bấm nút mỗi câu).
- **Database** — [LRCLIB](https://lrclib.net) (API miễn phí, open-source) trả về synced LRC cho nhiều bài. *Lưu ý: phải khớp đúng bản thu, lệch tempo sẽ trôi.*
- **Word-level (cho H3)** — dùng forced alignment (xem mục 3).

---

## 5. Định dạng dữ liệu lyric

### LRC line-level (hiện có — xem [[lyrics-remain-christian-kuria]])
```
[00:16.31] You've been living like a queen on such a small amount
[00:20.65] Closing your eyes to all your desires
```

### Parse thành JSON
```js
// line-level
[{ time: 16.31, text: "You've been living..." }, ...]

// word-level (mục tiêu H3)
[{
  time: 16.31,
  end: 20.65,
  words: [
    { time: 16.31, text: "You've" },
    { time: 16.74, text: "been" },
    ...
  ]
}]
```

---

## 6. MVP Scope

Prototype với đoạn chorus ~15–20s:
1. Parse một snippet `.lrc`.
2. Bind timeline của `<audio>` với lyric parser.
3. Trigger GSAP animation (zoom-in + fade) đúng lúc audio khớp timestamp.
4. (Mục tiêu H3) Animate **từng chữ** theo word-level timestamp.

User click "Play" mới chạy audio — **OK, đúng autoplay policy của trình duyệt** (đã xác nhận với user, không phải vấn đề).

---

## 7. Cấu trúc thư mục dự kiến

```
MusicAnimation/
├── docs/
│   ├── idea-kinetic-typography-player.md   ← file này
│   └── lyrics-i-will-remain.lrc            ← LRC line-level
├── index.html
├── assets/
│   ├── audio/clip.mp3
│   └── lyrics/song.lrc
├── src/
│   ├── styles/main.scss
│   └── js/
│       ├── lrc-parser.js      // .lrc → JSON
│       ├── word-timings.js    // getWordTimings() — H1/H2/H3
│       ├── sync-loop.js       // rAF + currentTime
│       └── animations.js      // GSAP timelines
```

---

## 8. Bài demo dự kiến

**"Remain" — Christian Kuria** (alt-R&B / bedroom soul, ~75 BPM, D minor, 2020 — album *Borderline*).
Lyrics line-level đã lưu tại [[lyrics-remain-christian-kuria]] (để chuyển sang word-level khi bắt đầu).
→ Hồ sơ bài hát đầy đủ + bảng hiệu ứng phù hợp + lộ trình build: xem [[effects-and-build-plan]].

---

## 9. ✅ Next steps / Điều kiện để bắt đầu

> [!todo] Chưa bắt đầu code — đợi data
> - [ ] Có **file nhạc** (`clip.mp3`) — đoạn ~15–20s hoặc full bài.
> - [ ] Có **lyrics word-level** (Enhanced LRC) — tự chấm hoặc forced-align (Whisper/aeneas).
> - [ ] Khi đủ 2 thứ trên → dựng boilerplate + sync loop + GSAP engine.

### Quyết định kỹ thuật đã chốt
- Animation **theo từng chữ**, dùng **Hướng 3 (word-level LRC)**.
- Sync bằng `audio.currentTime` + `requestAnimationFrame`.
- Chỉ animate `transform` + `opacity` để giữ 60fps.
- GSAP + Splitting.js.
- Tách `getWordTimings()` để có thể bắt đầu bằng H1 và nâng lên H3.

### Câu hỏi mở
- [x] Bài demo: **"Remain" — Christian Kuria** (đã chốt + research xong).
- [ ] Tạo word-level timestamp bằng tay hay forced alignment?
- [ ] Có cần waveform / visualizer ngoài lyrics không?
- [ ] Vanilla JS hay framework (Vite + vanilla là đủ cho MVP)?
