/* animations.js — dựng DOM dòng + trạng thái chuyển động (GSAP).
 * v3: spring easing (cảm giác lò xo kiểu Apple Music), active line to hơn, depth blur theo khoảng cách.
 *   .line > .word > .mask > .word-inner > .char   ·   hook -> class .hook (Instrument italic)
 */
window.KT = window.KT || {};
(function (KT) {
  const HOOK_RE = /i will remain/i;
  const ACTIVE_SCALE = 1.04;   // dòng đang hát to hơn
  const PAST_SCALE = 0.9;      // dòng đã hát nhỏ lại (lùi xa)

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
      { opacity: 0, y: 16, scale: 0.985, filter: 'blur(12px)' },
      { opacity: 1, y: 0, scale: ACTIVE_SCALE, filter: 'blur(0px)', duration: 1.05, ease: 'power2.out', overwrite: 'auto' });
    gsap.fromTo(inners,
      { yPercent: 110 },
      { yPercent: 0, duration: 0.95, ease: 'power3.out', stagger: 0.045, overwrite: 'auto' });
  }

  // Dòng đã hát -> ở lại nhưng nhỏ, mờ & nhòe dần theo khoảng cách (depth).
  function toPast(line, instant, opacity, blur) {
    gsap.to(line, {
      opacity: opacity == null ? 0.3 : opacity, scale: PAST_SCALE,
      filter: 'blur(' + (blur == null ? 0.5 : blur) + 'px)', y: 0,
      duration: instant ? 0 : 0.85, ease: 'power2.out', overwrite: 'auto' });
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
  KT.anim = { buildLineEl, enter, toPast, toActive, toFuture, HOOK_RE, ACTIVE_SCALE, PAST_SCALE };
})(window.KT);
