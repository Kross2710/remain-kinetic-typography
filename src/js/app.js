/* app.js — Aurora player (v2).
 * "Audio làm đồng hồ, GSAP chỉ phản ứng." Dòng tích tụ (đã hát thì ở lại, mờ dần theo khoảng cách).
 * Nền: Aurora (mặc định) hoặc VIDEO (đồng bộ theo thời gian bài). Từ "actionable" được animate mạnh.
 */
(function (KT) {
  const cues = KT.parseLRC(KT.RAW_LRC);
  const EMPH = new Set((KT.EMPHASIS || []).map((w) => w.toLowerCase()));
  function normWord(s) { return (s || '').toLowerCase().replace(/[^a-z']/g, ''); }

  const stage = document.getElementById('stage');
  const flow = document.getElementById('flow');
  const audio = document.getElementById('audio');
  const bgvideo = document.getElementById('bgvideo');
  const playBtn = document.getElementById('playBtn');
  const previewBtn = document.getElementById('previewBtn');
  const fileInput = document.getElementById('fileInput');
  const videoInput = document.getElementById('videoInput');
  const statusEl = document.getElementById('status');
  const eyebrowEl = document.getElementById('eyebrow');
  const timecodeEl = document.getElementById('timecode');
  const progressEl = document.getElementById('progress');

  const clock = new KT.Clock(audio);
  const lastTime = cues.length ? cues[cues.length - 1].time : 0;
  const firstTextCue = cues.find((c) => c.text);
  const previewStart = firstTextCue ? Math.max(0, firstTextCue.time - 1.5) : 0;

  // dựng sẵn toàn bộ dòng
  const lineEls = [];
  cues.forEach((c, i) => {
    if (!c.text) { lineEls[i] = null; return; }
    const el = KT.anim.buildLineEl(c.text);
    if (KT.anim.HOOK_RE.test(c.text)) el.classList.add('hook');
    el.classList.add('is-future');
    flow.appendChild(el);
    gsap.set(el, { opacity: 0 });
    lineEls[i] = el;
  });

  let curActive = -1;
  let wordEls = [], wordSegs = [], wordState = [];
  let rafId = null, seeking = false, videoOn = false;
  let lastSecName = null, lastTC = '';

  function endTimeOf(i) { return i + 1 < cues.length ? cues[i + 1].time : cues[i].time + 4; }
  function setStatus(m) { if (statusEl) statusEl.textContent = m; }
  function fmtTC(t) { const m = Math.floor(t / 60); const s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }

  function applyStates(active, instant) {
    for (let i = 0; i < lineEls.length; i++) {
      const el = lineEls[i]; if (!el) continue;
      if (i < active) {
        el.classList.remove('is-active', 'is-future'); el.classList.add('is-past');
        const dist = active - i;                          // 1 = gần nhất
        const op = Math.max(0, 0.44 - (dist - 1) * 0.14); // mờ dần theo khoảng cách
        const blur = Math.min(0.6 + (dist - 1) * 0.85, 3.4); // nhòe dần (depth)
        KT.anim.toPast(el, instant, op, blur);
      } else if (i === active) {
        el.classList.remove('is-past', 'is-future'); el.classList.add('is-active');
        if (instant) KT.anim.enter(el, true);
        else if (!el.dataset.seen) KT.anim.enter(el, false);
        else KT.anim.toActive(el, false);
        el.dataset.seen = '1';
      } else {
        el.classList.remove('is-active', 'is-past'); el.classList.add('is-future');
        KT.anim.toFuture(el, instant);
        delete el.dataset.seen;
      }
    }
  }

  function recenter(active, instant) {
    const el = lineEls[active]; if (!el) return;
    const target = stage.clientHeight * 0.58 - (el.offsetTop + el.offsetHeight / 2);
    gsap.to(flow, { y: target, duration: instant ? 0 : 1.0, ease: KT.spring, overwrite: 'auto' });
  }

  function onActiveChange(idx, forceInstant) {
    const instant = forceInstant || seeking || idx < curActive || (idx - curActive) > 1;
    curActive = idx;
    applyStates(idx, instant);
    recenter(idx, instant);
    const cue = cues[idx];
    if (cue && cue.text && lineEls[idx]) {
      wordSegs = KT.getWordTimings(cue.text, cue.time, endTimeOf(idx));
      wordEls = Array.from(lineEls[idx].querySelectorAll('.word'));
      wordState = wordEls.map(() => null);
    } else { wordSegs = []; wordEls = []; wordState = []; }
  }

  // ② Karaoke wipe LIÊN TỤC: mỗi frame set --p (0..1) cho từng chữ -> sáng dần trái→phải.
  //    + glow/pop khi chữ trở thành "current" (và mạnh hơn cho từ "actionable").
  function updateHighlight(t) {
    if (!wordEls.length || !wordSegs.length) return;
    let act = -1;
    for (let i = 0; i < wordSegs.length; i++) { if (t >= wordSegs[i].start) act = i; else break; }
    for (let i = 0; i < wordEls.length; i++) {
      const seg = wordSegs[i], el = wordEls[i];
      const chars = el.__chars || (el.__chars = el.querySelectorAll('.char'));
      const st = i < act ? 'sung' : (i === act ? 'current' : 'future');

      // chữ đang hát: cập nhật fill từng ký tự MỖI FRAME (wipe liên tục)
      if (i === act) {
        const d = Math.max(0.0001, seg.end - seg.start);
        let base = (t - seg.start) / d; if (base < 0) base = 0; else if (base > 1) base = 1;
        const n = chars.length;
        for (let j = 0; j < n; j++) { let cp = base * n - j; cp = cp < 0 ? 0 : (cp > 1 ? 1 : cp); chars[j].style.setProperty('--cp', cp.toFixed(3)); }
      }

      if (wordState[i] === st) continue;
      wordState[i] = st;
      if (st === 'sung') { for (let j = 0; j < chars.length; j++) chars[j].style.setProperty('--cp', '1'); }
      else if (st === 'future') { for (let j = 0; j < chars.length; j++) chars[j].style.setProperty('--cp', '0'); }
      el.classList.remove('is-current', 'is-emph');
      if (st === 'current') {
        el.classList.add('is-current');
        const emph = EMPH.has(normWord(el.textContent));
        if (emph) { el.classList.add('is-emph'); gsap.fromTo(el, { scale: 0.82 }, { scale: 1, duration: 0.55, ease: 'back.out(1.7)', overwrite: 'auto' }); }
        else { gsap.fromTo(el, { scale: 0.97 }, { scale: 1, duration: 0.3, ease: 'power2.out', overwrite: 'auto' }); }
      }
    }
  }

  function findActiveIndex(t) {
    let i = curActive < 0 ? 0 : curActive;
    while (i + 1 < cues.length && cues[i + 1].time <= t) i++;
    while (i >= 0 && (!cues[i] || cues[i].time > t)) i--;
    return i;
  }

  function updateChrome(t) {
    const sec = KT.sectionAt(t);
    KT.aurora.setSection(KT.PALETTE[sec.kind], sec.kind, false);
    if (sec.name !== lastSecName) { lastSecName = sec.name; if (eyebrowEl) eyebrowEl.textContent = sec.name; }
    const tc = fmtTC(t) + ' / ' + fmtTC(lastTime);
    if (tc !== lastTC) { lastTC = tc; if (timecodeEl) timecodeEl.textContent = tc; }
    if (progressEl && lastTime > 0) progressEl.style.transform = 'scaleX(' + Math.max(0, Math.min(1, t / lastTime)) + ')';
  }

  function syncVideo(t) {
    if (!videoOn) return;
    if (clock.isRunning() && bgvideo.paused) bgvideo.play().catch(() => {});
    const dur = bgvideo.duration || 0;
    const target = dur ? Math.min(t, dur - 0.05) : t;
    if (Math.abs(bgvideo.currentTime - target) > 0.35) { try { bgvideo.currentTime = target; } catch (e) {} }
  }

  function frame() {
    clock.tickVirtual();
    const t = clock.getTime();
    if (clock.mode === 'virtual' && t > lastTime + 3) {
      clock.endVirtual(); if (videoOn) bgvideo.pause();
      setStatus('■ Hết bài (xem thử). Bấm "Xem thử" để chạy lại.');
      rafId = null; return;
    }
    updateChrome(t);
    const idx = findActiveIndex(t);
    if (idx !== curActive) onActiveChange(idx, false);
    updateHighlight(t);
    syncVideo(t);
    if (clock.isRunning()) rafId = requestAnimationFrame(frame);
    else rafId = null;
  }
  function startLoop() { if (rafId == null) rafId = requestAnimationFrame(frame); }

  function resetView() {
    curActive = -1; wordEls = []; wordSegs = []; wordState = [];
    lineEls.forEach((el) => { if (!el) return; delete el.dataset.seen; el.classList.remove('is-active', 'is-past'); el.classList.add('is-future'); gsap.set(el, { opacity: 0 }); });
  }

  // ---- nền video ----
  function enableVideo() {
    videoOn = true; document.body.classList.add('has-video');
    bgvideo.play().catch(() => {}); // nền video tự phát (muted) ngay khi sẵn sàng, kể cả chưa bấm Phát
  }
  bgvideo.addEventListener('loadeddata', enableVideo);
  bgvideo.addEventListener('error', () => { /* không có bg.mp4 -> giữ nền Aurora */ });
  bgvideo.src = 'assets/video/bg-web.mp4'; // bản nhẹ H.264 (commit lên repo); bg.mp4 gốc giữ ở local
  videoInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    bgvideo.src = URL.createObjectURL(f); enableVideo();
    if (clock.isRunning()) bgvideo.play().catch(() => {});
  });

  // ---- audio events ----
  audio.addEventListener('play', () => { clock.mode = 'audio'; setStatus('▶ Đang phát'); if (videoOn) bgvideo.play().catch(() => {}); startLoop(); });
  audio.addEventListener('pause', () => { if (videoOn) bgvideo.pause(); if (!audio.ended) setStatus('⏸ Tạm dừng'); });
  audio.addEventListener('ended', () => { if (videoOn) bgvideo.pause(); setStatus('■ Hết bài'); });
  audio.addEventListener('seeking', () => { seeking = true; });
  audio.addEventListener('seeked', () => {
    seeking = false; const t = clock.getTime();
    updateChrome(t); onActiveChange(findActiveIndex(t), true); updateHighlight(t); syncVideo(t);
  });

  // ---- controls ----
  playBtn.addEventListener('click', () => {
    clock.mode = 'audio';
    audio.play().catch((e) => setStatus('Chưa phát được (' + e.name + '). Dùng "Chọn nhạc…" hoặc "Xem thử".'));
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    audio.src = URL.createObjectURL(f); clock.mode = 'audio'; resetView(); audio.play().catch(() => {});
  });
  previewBtn.addEventListener('click', () => {
    if (clock.mode === 'virtual' && clock.isRunning()) { clock.pauseVirtual(); if (videoOn) bgvideo.pause(); setStatus('⏸ Xem thử (tạm dừng)'); return; }
    audio.pause();
    if (clock.mode !== 'virtual') { resetView(); clock.startVirtual(previewStart); }
    else clock.resumeVirtual();
    if (videoOn) bgvideo.play().catch(() => {});
    setStatus('▶ Xem thử (không nhạc)'); startLoop();
  });

  // ---- chrome tự ẩn ----
  let idleTimer = null;
  function wake() { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('idle'), 2800); }
  ['mousemove', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
  wake();

  window.addEventListener('resize', () => recenter(curActive, true));

  KT.debug = {
    cues,
    renderAt(t) {
      clock.mode = 'virtual'; clock.setVirtual(t); clock.pauseVirtual();
      const sec = KT.sectionAt(t); KT.aurora.setSection(KT.PALETTE[sec.kind], sec.kind, true);
      if (eyebrowEl) eyebrowEl.textContent = sec.name; lastSecName = sec.name;
      onActiveChange(findActiveIndex(t), true);
      updateHighlight(t); updateChrome(t);
    },
  };

  setStatus('Sẵn sàng — bấm "Xem thử" hoặc thả clip.mp3 vào assets/audio/ rồi Phát. Nền video: thả bg.mp4 vào assets/video/.');
  console.log('[KT] Aurora v2 · cues:', cues.length, '· word-level:', KT.WORD_DATA ? KT.WORD_DATA.length : 0, '· emphasis:', EMPH.size);
})(window.KT);
