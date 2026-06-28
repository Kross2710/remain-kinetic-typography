/* aurora-bg.js — điều khiển màu trường Aurora qua CSS variables (--au1/--au2/--accent).
 * Khi đổi đoạn, nội suy (lerp) màu mượt trong ~2.6s để hue chuyển dịu, không nhảy giật.
 */
window.KT = window.KT || {};
(function (KT) {
  const root = document.documentElement;

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbStr(a) { return 'rgb(' + a.map(Math.round).join(',') + ')'; }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  let cur = null;     // { au1:[r,g,b], au2, accent }
  let lastKind = null;
  let tween = null;

  function write(c) {
    root.style.setProperty('--au1', rgbStr(c.au1));
    root.style.setProperty('--au2', rgbStr(c.au2));
    root.style.setProperty('--accent', rgbStr(c.accent));
  }

  function setSection(pal, kind, instant) {
    if (kind === lastKind) return;
    lastKind = kind;

    const to = { au1: hexToRgb(pal.au1), au2: hexToRgb(pal.au2), accent: hexToRgb(pal.accent) };
    if (!cur || instant || !window.gsap) { cur = to; write(cur); return; }

    const from = { au1: cur.au1.slice(), au2: cur.au2.slice(), accent: cur.accent.slice() };
    if (tween) tween.kill();
    const p = { v: 0 };
    tween = gsap.to(p, {
      v: 1, duration: 2.6, ease: 'sine.inOut',
      onUpdate() {
        cur = { au1: mix(from.au1, to.au1, p.v), au2: mix(from.au2, to.au2, p.v), accent: mix(from.accent, to.accent, p.v) };
        write(cur);
      },
    });
  }

  KT.aurora = { setSection };
})(window.KT);
