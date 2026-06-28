/* animations.js — dựng DOM một dòng + các trạng thái chuyển động (GSAP, chỉ transform/opacity/blur).
 *   .line > .word > .mask > .word-inner > .char
 *   Hook ("I will remain") -> app gắn class .hook (đổi sang Instrument Serif qua CSS).
 *
 * Mô hình: TẤT CẢ dòng dựng sẵn & xếp chồng trong .flow. Trạng thái:
 *   future = ẩn · active = vào bằng blur→nét + chữ trượt lên · past = ở lại, mờ & lùi nhẹ.
 */
window.KT = window.KT || {};
(function (KT) {
  const HOOK_RE = /i will remain/i;

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

  // VÀO: blur → nét, dòng nổi lên, từng chữ trượt lên qua mask.
  function enter(line, instant) {
    const inners = line.querySelectorAll('.word-inner');
    if (instant) {
      gsap.set(line, { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' });
      gsap.set(inners, { yPercent: 0 });
      return;
    }
    gsap.fromTo(line,
      { opacity: 0, y: 16, scale: 0.99, filter: 'blur(12px)' },
      { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 1.05, ease: 'power2.out', overwrite: 'auto' });
    gsap.fromTo(inners,
      { yPercent: 110 },
      { yPercent: 0, duration: 0.95, ease: 'power3.out', stagger: 0.045, overwrite: 'auto' });
  }

  // Dòng đã hát xong -> ở lại nhưng lùi & mờ (KHÔNG biến mất).
  // opacity mờ dần theo khoảng cách (app truyền vào) -> giảm rối, nhất là trên mobile.
  function toPast(line, instant, opacity) {
    gsap.to(line, { opacity: opacity == null ? 0.3 : opacity, scale: 0.95, filter: 'blur(0.5px)', y: 0,
      duration: instant ? 0 : 0.85, ease: 'power2.out', overwrite: 'auto' });
  }
  // Kích hoạt lại một dòng đã hiện (vd seek lùi).
  function toActive(line, instant) {
    gsap.to(line, { opacity: 1, scale: 1, filter: 'blur(0px)', y: 0,
      duration: instant ? 0 : 0.5, ease: 'power2.out', overwrite: 'auto' });
  }
  function toFuture(line, instant) {
    gsap.to(line, { opacity: 0, duration: instant ? 0 : 0.4, overwrite: 'auto' });
  }

  KT.anim = { buildLineEl, enter, toPast, toActive, toFuture, HOOK_RE };
})(window.KT);
