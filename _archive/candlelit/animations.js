/* animations.js
 * Mọi hiệu ứng GSAP đều CHỈ dùng transform (yPercent/y/scale) + opacity (+ blur khi exit)
 * để chạy trên GPU, giữ 60fps. Cấu trúc DOM một dòng:
 *
 *   .line > .word > .mask > .word-inner > .char
 *           (màu/độ mờ ở .word)   (overflow hidden để "che" chữ khi trượt)
 */
window.KT = window.KT || {};
(function (KT) {
  // Câu hook -> dùng ⑥ character cascade thay cho ① word-rise.
  const HOOK_RE = /i will remain/i;

  function buildLineEl(text) {
    const line = document.createElement('div');
    line.className = 'line';

    const words = text.split(/\s+/).filter(Boolean);
    words.forEach((w) => {
      const word = document.createElement('span');
      word.className = 'word';

      const mask = document.createElement('span');
      mask.className = 'mask';

      const inner = document.createElement('span');
      inner.className = 'word-inner';

      for (const ch of w) {
        const c = document.createElement('span');
        c.className = 'char';
        c.textContent = ch;
        inner.appendChild(c);
      }
      mask.appendChild(inner);
      word.appendChild(mask);
      line.appendChild(word);
    });
    return line;
  }

  // ① / ⑥ Hiệu ứng VÀO
  function enterLine(lineEl, text, instant) {
    const inners = lineEl.querySelectorAll('.word-inner');
    const chars = lineEl.querySelectorAll('.char');

    if (instant) {
      // Khi seek/nhảy: hiện ngay, không chạy animation vào.
      gsap.set(inners, { yPercent: 0 });
      gsap.set(chars, { yPercent: 0, opacity: 1 });
      return;
    }

    if (HOOK_RE.test(text)) {
      // ⑥ Character cascade — dành riêng cho hook "I will remain".
      gsap.set(inners, { yPercent: 0 });
      gsap.from(chars, {
        yPercent: 100, opacity: 0, duration: 0.6, ease: 'expo.out',
        stagger: 0.025, overwrite: 'auto'
      });
    } else {
      // ① Masked word-rise — chữ trượt lên qua khung che.
      gsap.set(chars, { opacity: 1 });
      gsap.from(inners, {
        yPercent: 110, duration: 0.9, ease: 'power3.out',
        stagger: 0.06, overwrite: 'auto'
      });
    }
  }

  // ③ Exhale-out — dòng rời đi như một hơi thở ra (chìm xuống + mờ + hơi nhoè).
  function exitLine(lineEl, onDone) {
    gsap.to(lineEl, {
      opacity: 0, y: 20, scale: 0.985, filter: 'blur(4px)',
      duration: 0.9, ease: 'power2.in', overwrite: 'auto',
      onComplete: onDone
    });
  }

  KT.anim = { buildLineEl, enterLine, exitLine, HOOK_RE };
})(window.KT);
