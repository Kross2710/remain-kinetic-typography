/* animations.js — dựng DOM dòng + trạng thái chuyển động (GSAP).
 * v3: spring easing (cảm giác lò xo kiểu Apple Music), active line to hơn, depth blur theo khoảng cách.
 *   .line > .word > .mask > .word-inner > .char   ·   hook -> class .hook (Instrument italic)
 */
window.KT = window.KT || {};
(function (KT) {
  const HOOK_RE = /i will remain/i;
  const ACTIVE_SCALE = 1.04;   // dòng đang hát to hơn
  const PAST_SCALE = 0.9;      // dòng đã hát nhỏ lại (lùi xa)
  const EXHALE_RISE = -14;     // exhale-out: câu rời đi nhích LÊN (px) như một hơi thở ra (kèm mờ + nhòe + co)

  // Spring giảm chấn: vào nhanh, dội nhẹ 1 nhịp rồi ổn định (truyền cho GSAP làm ease).
  function spring(p) { return 1 - Math.exp(-8 * p) * Math.cos(7 * p); }

  function buildLineEl(text) {
    const line = document.createElement('div');
    line.className = 'line';
    text.split(/\s+/).filter(Boolean).forEach((w) => {
      const word = document.createElement('span'); word.className = 'word';
      const mask = document.createElement('span'); mask.className = 'mask';
      const inner = document.createElement('span'); inner.className = 'word-inner';
      for (const ch of w) {
        const c = document.createElement('span'); c.className = 'char'; c.textContent = ch;
        inner.appendChild(c);
      }
      mask.appendChild(inner); word.appendChild(mask); line.appendChild(word);
    });
    return line;
  }

  // VÀO: blur→nét + nổi lên + chữ trượt lên qua mask. Kết thúc ở ACTIVE_SCALE.
  function enter(line, instant) {
    const inners = line.querySelectorAll('.word-inner');
    if (instant) {
      gsap.set(line, { opacity: 1, y: 0, scale: ACTIVE_SCALE, filter: 'blur(0px)' });
      gsap.set(inners, { yPercent: 0 });
      return;
    }
    gsap.fromTo(line,
      { opacity: 0, y: 14, scale: 0.99, filter: 'blur(10px)' },
      { opacity: 1, y: 0, scale: ACTIVE_SCALE, filter: 'blur(0px)', duration: 1.25, ease: 'power2.out', overwrite: 'auto' });
    gsap.fromTo(inners,
      { yPercent: 110 },
      { yPercent: 0, duration: 1.1, ease: 'power3.out', stagger: 0.05, overwrite: 'auto' });
  }

  // VÀO kiểu INK SOAK (chỉ dòng hook): từng KÝ TỰ "thấm" vào TẠI CHỖ — nhòe→nét + mờ→rõ
  // (blur SOAK_BLUR→0 + opacity 0.04→1, stagger trái→phải). KHÔNG blur cả dòng, KHÔNG trồi lên
  // (đó là điểm khác hẳn enter() thường, để cảm RÕ là "mực thấm" chứ không phải trượt lên).
  // blur đặt trên .char (KHÁC element với drop-shadow ở .word -> shadow legibility vẫn còn) và
  // ≤ padding 0.12em của .mask nên không bị overflow cắt theo chiều dọc. BỎ QUA .is-held ("love").
  const SOAK_BLUR = 3;   // px nhòe ban đầu của mỗi ký tự khi thấm vào (tăng = "loang" mạnh hơn)
  function enterInk(line, instant) {
    const inHeld = (n) => { const w = n.closest('.word'); return w && w.classList.contains('is-held'); };
    const chars = Array.from(line.querySelectorAll('.char')).filter((n) => !inHeld(n));
    const inners = Array.from(line.querySelectorAll('.word-inner')).filter((n) => !inHeld(n));
    gsap.set(inners, { yPercent: 0 });                                              // không slide — thấm tại chỗ
    gsap.set(line, { opacity: 1, y: 0, scale: ACTIVE_SCALE, filter: 'blur(0px)' });  // .line giữ NÉT; .char tự thấm
    if (instant) { gsap.set(chars, { opacity: 1, filter: 'blur(0px)' }); return; }
    gsap.fromTo(chars,
      { opacity: 0.04, filter: 'blur(' + SOAK_BLUR + 'px)' },
      { opacity: 1, filter: 'blur(0px)', duration: 0.95, ease: 'power2.out', stagger: 0.05, overwrite: 'auto' });
  }

  // Từ ẩn ("love"): giữ vô hình tới đúng lúc singer hát -> rồi THẤM vào y hệt ink-soak (per-char nhòe→nét).
  function hideHeld(wordEl) { gsap.set(wordEl, { opacity: 0 }); }
  function revealHeld(wordEl, instant) {
    const chars = wordEl.querySelectorAll('.char');
    gsap.set(wordEl, { opacity: 1 });
    if (instant) { gsap.set(chars, { opacity: 1, filter: 'blur(0px)' }); return; }
    gsap.fromTo(chars,
      { opacity: 0.04, filter: 'blur(' + SOAK_BLUR + 'px)' },
      { opacity: 1, filter: 'blur(0px)', duration: 0.85, ease: 'power2.out', stagger: 0.06, overwrite: 'auto' });
  }

  // Dòng đã hát -> THỞ RA: ở lại nhưng nhích lên + mờ + nhòe + co nhỏ dần theo khoảng cách (depth).
  function toPast(line, instant, opacity, blur, rise) {
    gsap.to(line, {
      opacity: opacity == null ? 0.3 : opacity, scale: PAST_SCALE,
      filter: 'blur(' + (blur == null ? 0.5 : blur) + 'px)', y: rise == null ? 0 : rise,
      duration: instant ? 0 : 1.05, ease: 'power2.out', overwrite: 'auto' });
  }
  // Kích hoạt lại (seek lùi) -> dội lò xo về ACTIVE_SCALE.
  function toActive(line, instant) {
    gsap.to(line, { opacity: 1, scale: ACTIVE_SCALE, filter: 'blur(0px)', y: 0,
      duration: instant ? 0 : 0.6, ease: spring, overwrite: 'auto' });
  }
  function toFuture(line, instant) {
    gsap.to(line, { opacity: 0, duration: instant ? 0 : 0.4, overwrite: 'auto' });
  }

  KT.spring = spring;
  KT.anim = { buildLineEl, enter, enterInk, revealHeld, hideHeld, toPast, toActive, toFuture, HOOK_RE, ACTIVE_SCALE, PAST_SCALE, EXHALE_RISE };
})(window.KT);
