---
title: "Remain (Christian Kuria) — Effects & Build Plan"
aliases:
  - Effects Palette
  - Build Plan
tags:
  - project
  - research
  - animation
  - gsap
status: research-done
created: 2026-06-28
updated: 2026-06-28
---

# 🎬 Remain — Effects & Build Plan

> [!info] Nguồn
> Tổng hợp từ research 3 luồng (hồ sơ bài hát + hiệu ứng phù hợp + scope cho người mới). Bài chính: [[idea-kinetic-typography-player]]. Lyrics: [[lyrics-remain-christian-kuria]].

---

## 1. Hồ sơ bài hát (đã xác minh)

| Thuộc tính | Giá trị |
|---|---|
| **Bài** | Remain |
| **Nghệ sĩ** | Christian Kuria |
| **Album/EP** | Borderline (phát hành 29/01/2020) |
| **Thể loại** | Alternative R&B / bedroom soul (neo-soul leaning) |
| **Tempo** | ~75 BPM, key **D minor** — slow-jam ballad, lững lờ, thân mật |
| **Thời lượng** | ~3:15 |
| **Mood** | Dịu dàng, day dứt ngọt ngào, như lời thề, ấm mà hơi đau |
| **Cấu trúc** | Intro → Verse 1 → Chorus → Verse 2 → Chorus → Bridge → Chorus/Outro |

> [!quote] Cảm giác bài hát
> Ballad alt-R&B thì thầm, xoay quanh **falsetto ấm nhiều lớp** + **guitar điện gảy nhẹ**. Phối khí thưa, atmospheric, nhiều reverb. Năng lượng **kìm nén suốt bài** — không bùng nổ cao trào, mà dâng cảm xúc qua lớp bè và điệp khúc lặp lại như lời thề *"But I will remain, love"*. Giống một lời tỏ tình dưới ánh nến.

> [!check] Đính chính
> Lyrics đã gửi **đúng là của bài này** (xác minh qua Shazam / Letras / Apple Music). File `lyrics-i-will-remain.lrc` cũ (gán nhầm Matthew Mole) đã được thay bằng `lyrics-remain-christian-kuria.lrc`.

---

## 2. ⭐ Nguyên tắc chỉ đạo: "Whisper, not shout"

Bài này chậm, riêng tư, tình cảm → animation phải **thì thầm**, không "hype". Mọi hiệu ứng đều chỉ dùng `transform` + `opacity` (giữ 60fps), ease luôn **giảm tốc nhẹ nhàng** (`power`, `sine`, `expo`) — **không** dùng `elastic`/`back` (nảy quá vui nhộn, chỏi với nỗi buồn).

---

## 3. 🎨 Bảng hiệu ứng PHÙ HỢP

> [!tip] Cho người mới: bắt đầu với 3 cái CORE, thêm dần phần còn lại
> **Core (làm trước):** ① Masked word rise · ② Active-word highlight · ③ Exhale-out exit
> **Thêm sau:** ④ Soft blur-focus · ⑤ Slow drift · ⑥ Character cascade (chỉ cho hook)

### ① Masked line/word rise — hiệu ứng nền tảng
Chữ trượt lên từ dưới qua một khung `overflow:hidden`, như "mọc" ra từ hư không.
```js
// SplitText/Splitting tách thành words, đặt trong wrapper overflow:hidden
gsap.from(words, { yPercent: 110, duration: 0.9, ease: 'power3.out', stagger: 0.06 });
```
*Hợp vì:* vào như một hơi thở giữ lại, restraint kiểu "film title".

### ② Active-word highlight / dim-the-rest — linh hồn karaoke
Cả dòng hiện mờ (opacity ~0.25), từng chữ sáng lên **đúng nhịp hát** rồi dịu lại.
```js
gsap.to(word, { opacity: 1, duration: 0.25, ease: 'power1.out' }); // rồi trả về ~0.4
```
*Hợp vì:* như ngón tay lần theo lời hát — giữ người nghe trong câu, tương phản bằng cảm xúc chứ không phô trương. **Đây là hiệu ứng quan trọng nhất cho cảm giác lyric-video thân mật.**

### ③ Exhale-out — câu rời đi như một hơi thở ra
Đừng cắt phụt; cho câu cũ chìm xuống + mờ đi.
```js
gsap.to(line, { opacity: 0, y: 20, filter: 'blur(4px)', scale: 0.98, duration: 1.0, ease: 'power2.in' });
```
*Hợp vì:* mỗi câu có "kết", hợp với mood lưu luyến.

### ④ Soft blur-focus fade-in — cho câu đặc biệt
Chữ hiện từ mờ-nhòe → nét, như một ký ức đang rõ dần.
```js
gsap.from(words, { opacity: 0, y: 14, filter: 'blur(8px)', duration: 0.7, ease: 'power2.out', stagger: 0.04 });
```
> [!warning] `filter: blur` KHÔNG phải transform/opacity → tốn GPU. Chỉ dùng cho **dòng đang active**, không bao giờ cả khổ; tắt trên mobile; giữ blur ≤ 8px.

### ⑤ Slow drift / parallax — giữ khung "sống"
Sau khi hiện xong, dòng trôi rất chậm để khung không chết cứng.
```js
gsap.to(line, { y: '-=12', duration: 6, ease: 'none' });
```

### ⑥ Per-word breathing fade — biến thể nhẹ của ②
```js
gsap.from(word, { opacity: 0, scale: 0.94, y: 6, duration: 0.5, ease: 'sine.out', transformOrigin: 'center' });
```

### ⑦ Character cascade — DÀNH RIÊNG cho hook
Chỉ dùng cho **tiêu đề** hoặc câu payoff *"But I will remain, love"*.
```js
gsap.from(chars, { yPercent: 100, opacity: 0, duration: 0.6, ease: 'expo.out', stagger: 0.025 }); // tổng < ~1s
```
*Hợp vì:* để dành một khoảnh khắc nhấn cho điệp khúc, phần còn lại vẫn tĩnh lặng.

---

## 4. 🚫 TRÁNH (chỏi với mood)

- Beat-shake / screen punch mỗi chữ — bài không có beat mạnh, giật = hung hăng.
- Ease nảy `elastic`/`back.out` — vui tươi, chỏi nỗi buồn.
- Gõ chữ kiểu súng máy / nhấp nháy nhanh — quá cuồng so với tempo.
- Glitch / datamosh / RGB-split / scanline — lạnh, số hóa; chỏi nhạc soul ấm.
- Neon bão hòa / gradient cầu vồng — hype EDM, phá palette trầm.
- Xoay mạnh / lật 3D chữ — gimmick, kéo focus khỏi ý nghĩa.
- Scale pop lớn (0→1 overshoot) — kiểu meme/hype, không phải ballad.
- Strobing / zoom punch / cắt cảnh nhanh — mệt ở tempo chậm.
- Jitter/wiggle liên tục từng chữ — bồn chồn, chỏi sự tĩnh.

---

## 5. ✍️ Typography

- **Font:** serif tinh tế kể chuyện (Cormorant, Playfair Display, EB Garamond, IM Fell, Mrs Eaves) — đậm chất tâm tình. Hoặc sans humanist mảnh (Inter, Neue Haas) weight 300–400 nếu muốn hiện đại.
- Cỡ **lớn**, line-height & letter-spacing rộng — khoảng trắng là một phần cảm xúc.
- Ưu tiên **weight nhẹ**; chỉ tăng weight/italic cho chữ nhấn ở hook.
- **Sentence case / lowercase**, KHÔNG all-caps (caps = quát, chỏi mood).
- Chỉ 1–2 dòng ngắn trên màn hình; italic rất hợp cho câu dễ tổn thương nhất.

## 6. 🌑 Màu & nền

- **Nền tối, ấm, trầm:** charcoal / navy sâu / plum-burgundy / nâu ấm. **Tránh #000 thuần** (phẳng, gắt) — dùng tối ấm như `#0E0B0A`, `#14110F`, hoặc plum sâu `#1A1320`.
- **Chữ:** off-white / cream / amber nhạt (không phải `#FFF` gắt) — cảm giác ánh nến.
- Gần như đơn sắc + **một** accent ấm cho chữ active/hook.
- Thêm chiều sâu: film-grain nhẹ + vignette + bloom mềm; nền chuyển động **cực chậm** (chỉ transform/opacity).
- Tinh thần: tương phản & bão hòa **thấp** — như một căn phòng thắp đèn mờ, nâng giọng hát chứ không cạnh tranh.

---

## 7. 🛠️ Nên dựng những gì (scope cho người mới)

> [!important] Insight kiến trúc quan trọng nhất
> **"Audio làm đồng hồ, GSAP chỉ phản ứng."** ĐỪNG dựng một GSAP timeline dài chạy song song với audio — chúng **sẽ trôi** và seek sẽ vỡ. Thay vào đó: `rAF` đọc `audio.currentTime` → tìm cue active → **chỉ khi dòng đổi** mới bắn một tween ngắn (0.3–0.8s) cho dòng đó. Drift vô hình, scrub chỉ "snap" sang đúng dòng ở frame kế.

### Lộ trình MVP
| Phase | Việc | Giờ ước tính |
|---|---|---|
| **0** | Setup Vite + `npm i gsap`; bỏ 1 mp3 + .lrc vào `/public`; audio phát được | 1–2h |
| **1** | Parser `.lrc` → mảng `{time, text}` đã sort; bỏ tag metadata | 2–3h |
| **2** | `rAF` clock đọc `currentTime`, đổi `textContent` 1 div — **chưa animate**; start/stop theo play/pause | 2–3h |
| **3** | GSAP line-level: dòng cũ exit + dòng mới enter (SplitText + stagger), mỗi dòng < 0.7s | 3–5h |
| **4** | Seek-safe: nghe `seeking`/`seeked`, kill tween đang chạy, snap đúng dòng; chặn index lùi | 3–5h |
| **5** | Autoplay (Play button + `.catch(NotAllowedError)`), highlight 3 dòng, style, responsive | 2–4h |
| **6** | (Stretch) Word-level: lấy timestamp từng chữ (WhisperX/aeneas), dùng lại đúng pattern clock ở mức chữ | +nhiều |

### Libraries / tools
- **GSAP 3.13+** — giờ **100% miễn phí cả commercial**, gồm cả **SplitText** ⇒ **không cần Splitting.js nữa** (SplitText tích hợp native, có masking + `autoSplit`/`onSplit` để re-split responsive). Splitting.js chỉ là fallback.
- **Vite** — dev server + HMR, import ESM `gsap` sạch, khỏi vật lộn thứ tự script CDN.
- **Word-level timestamps:** **WhisperX** (auto từ audio) hoặc **aeneas** (align lyrics có sẵn). Với nhạc có nhạc nền, **tách vocal trước** bằng **Demucs/UVR** rồi mới align; chừa thời gian sửa tay. **MFA** chính xác nhất nhưng nặng để cài.

### Pitfalls (bẫy hay gặp)
1. **Drift** do timeline dài chạy song song → để `currentTime` là source of truth, chỉ bắn tween ngắn.
2. **Seeking vỡ** → nghe `seeking`/`seeked`, recompute cue, kill tween, snap end-state.
3. **Autoplay bị chặn** → `play()` phải trong click handler, `.catch()` `NotAllowedError`.
4. **Tween chồng nhau** khi dòng đổi nhanh → `overwrite: 'auto'` hoặc `.kill()` timeline cũ; `revert()` SplitText để khỏi rò element.
5. **`timeupdate` quá thưa** (~4 lần/s) → dùng `rAF` cho clock; `timeupdate` chỉ để cập nhật progress bar.
6. **Performance** → chỉ animate transform/opacity, chỉ split dòng đang hiện, revert dòng off-screen.
7. **Tra cue sai** → theo dõi index hiện tại, "cue lớn nhất có time ≤ currentTime"; đừng scan từ 0 mỗi frame.
8. **LRC parsing** → file thật có metadata, nhiều timestamp/dòng, dòng trống, BOM; sort theo time sau khi parse.
9. **Forced-alignment trên nhạc** → aligner tuned cho speech; timestamp trên full-mix dễ lệch → tách vocal + sửa tay.

### Ước tính thời gian (người làm lần đầu)
- Line-level chạy được: **một cuối tuần (8–12h)**.
- Line-level polish, seek-safe, autoplay: **~1–2 tuần buổi tối (20–30h)**.
- Thêm word-level + pipeline forced-alignment: **+1–2 tuần (15–25h)** — phần lớn thời gian là **chỉnh timestamp**, không phải code animation.
- Tổng tới kết quả word-level polish: **~4–6 tuần part-time**.

---

## 8. 🎯 Đề xuất "vibe" cuối cùng cho Remain

> Nền plum/charcoal rất tối + grain mờ + vignette. Lyrics serif cream cỡ lớn, 1–2 dòng giữa màn hình. Chữ **mọc lên qua mask** (①), từng chữ **sáng theo giọng hát** (②) trong khi phần còn lại của dòng mờ đi, câu cũ **thở ra chìm xuống** (③). Câu đặc biệt (vd "Hidden underneath the torment of our yesterdays") dùng **blur-focus** (④). Hook *"But I will remain, love"* dùng **character cascade** (⑦) + một accent ấm. Nền trôi cực chậm để khung luôn "thở". Tất cả ease giảm tốc mềm. → một lyric-video dưới ánh nến.

---

## 9. Tham khảo (đã mở khi research)

**Bài hát:** Apple Music · Shazam · Letras.com · Tunebat · Spotify
**GSAP / kỹ thuật:**
- GSAP 3.13 (free + SplitText): https://gsap.com/blog/3-13/
- SplitText docs: https://gsap.com/docs/v3/Plugins/SplitText/
- SplitText guide (mask/blur/ease): https://lab.good-fella.com/blog/gsap-text-animation-splittext-guide
- Conflict/overwrite tweens: https://gsap.com/resources/conflict/
- Sync sound ↔ transcript (forum): https://gsap.com/community/forums/topic/33415-syncing-sound-with-transcript-gsap/
- Autoplay (MDN): https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
- Audio viz + GSAP (Smashing): https://www.smashingmagazine.com/2022/03/audio-visualization-javascript-gsap-part2/

**Design / lyric-video:**
- Fonts cho lyric video: https://www.epitrite.com/blog/best-fonts-for-lyric-videos
- Background cho lyric video: https://www.epitrite.com/blog/lyric-video-backgrounds-guide
- Kinetic typography examples: https://www.todaymade.com/blog/kinetic-typography-examples
- Christian Kuria spotlight: https://www.thelunacollective.co/journal/spotlight-christian-kuria

**Forced alignment (word-level):**
- WhisperX: https://github.com/m-bain/whisperX
- So sánh MFA vs WhisperX vs MMS: https://arxiv.org/html/2406.19363v1
