/* app.js — bộ điều phối
 * NGUYÊN TẮC: "Audio làm đồng hồ, GSAP chỉ phản ứng."
 *   - rAF loop đọc clock.getTime() mỗi frame.
 *   - CHỈ khi dòng đổi mới bắn 1 tween ngắn (enter/exit). Không có timeline dài chạy song song
 *     => không trôi (drift), seek chỉ "snap" sang đúng dòng ở frame kế.
 *   - Highlight từng chữ (②) được TÍNH lại mỗi frame từ clock => tự khắc seek-safe.
 */
(function (KT) {
  const cues = KT.parseLRC(KT.RAW_LRC);

  // --- DOM refs ---
  const stage = document.getElementById('stage');
  const audio = document.getElementById('audio');
  const playBtn = document.getElementById('playBtn');
  const previewBtn = document.getElementById('previewBtn');
  const fileInput = document.getElementById('fileInput');
  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progress');

  // Màu lấy từ CSS variable (GSAP tween được giá trị màu thật, không tween được "var(--x)").
  const rootCss = getComputedStyle(document.documentElement);
  const COL_TEXT = rootCss.getPropertyValue('--text').trim() || '#ece3d4';
  const COL_ACCENT = rootCss.getPropertyValue('--accent').trim() || '#f0b15c';

  const clock = new KT.Clock(audio);
  const lastTime = cues.length ? cues[cues.length - 1].time : 0;
  const firstTextCue = cues.find((c) => c.text);
  // "Xem thử" bắt đầu ngay trước câu đầu để khỏi phải nhìn màn hình trống 16s.
  const previewStart = firstTextCue ? Math.max(0, firstTextCue.time - 1.5) : 0;

  // --- trạng thái dòng hiện tại ---
  let currentIndex = -1;
  let currentLineEl = null;
  let wordEls = [];     // các .word của dòng hiện tại
  let wordSegs = [];    // timing { word, start, end } tương ứng
  let wordState = [];   // 'past' | 'current' | 'future' đã áp (tránh tween thừa mỗi frame)
  let rafId = null;
  let seeking = false;

  function endTimeOf(i) {
    return i + 1 < cues.length ? cues[i + 1].time : cues[i].time + 4;
  }

  function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }

  // Dựng & hiển thị dòng index. instant=true => không chạy animation vào (dùng khi seek/nhảy).
  function setLine(index, instant) {
    if (currentLineEl) {
      const old = currentLineEl;
      if (instant) old.remove();              // nhảy: bỏ ngay, tránh chồng dòng
      else KT.anim.exitLine(old, () => old.remove()); // phát thường: exhale-out
    }
    currentLineEl = null;
    wordEls = []; wordSegs = []; wordState = [];
    currentIndex = index;

    const cue = cues[index];
    if (!cue || !cue.text) return; // ngoài bài hoặc cue rỗng -> để màn hình trống

    const lineEl = KT.anim.buildLineEl(cue.text);
    stage.appendChild(lineEl);
    currentLineEl = lineEl;
    KT.anim.enterLine(lineEl, cue.text, instant);

    wordEls = Array.from(lineEl.querySelectorAll('.word'));
    wordState = wordEls.map(() => null);
    wordSegs = KT.getWordTimings(cue.text, cue.time, endTimeOf(index));
  }

  // ② Active-word highlight: dim cả dòng, sáng chữ đang được hát.
  function updateHighlight(t) {
    if (!wordEls.length || !wordSegs.length) return;

    let active = -1;
    for (let i = 0; i < wordSegs.length; i++) {
      if (t >= wordSegs[i].start) active = i; else break;
    }

    for (let i = 0; i < wordEls.length; i++) {
      const state = i < active ? 'past' : (i === active ? 'current' : 'future');
      if (wordState[i] === state) continue; // chỉ tween khi đổi trạng thái
      wordState[i] = state;

      const el = wordEls[i];
      if (state === 'current') {
        gsap.to(el, { opacity: 1, y: -2, color: COL_ACCENT, duration: 0.25, ease: 'power1.out', overwrite: 'auto' });
      } else if (state === 'past') {
        gsap.to(el, { opacity: 0.72, y: 0, color: COL_TEXT, duration: 0.4, ease: 'power1.out', overwrite: 'auto' });
      } else {
        gsap.to(el, { opacity: 0.26, y: 0, color: COL_TEXT, duration: 0.4, ease: 'power1.out', overwrite: 'auto' });
      }
    }
  }

  // Tìm cue active = cue lớn nhất có time <= t. Đi từ currentIndex để khỏi quét lại từ 0.
  function findActiveIndex(t) {
    let i = currentIndex < 0 ? 0 : currentIndex;
    while (i + 1 < cues.length && cues[i + 1].time <= t) i++;     // tiến
    while (i >= 0 && (!cues[i] || cues[i].time > t)) i--;          // lùi (seek về trước)
    return i; // có thể = -1 nếu t trước cue đầu tiên
  }

  function updateProgress(t) {
    if (!progressEl || lastTime <= 0) return;
    const p = Math.max(0, Math.min(1, t / lastTime));
    progressEl.style.transform = 'scaleX(' + p + ')';
  }

  function frame() {
    clock.tickVirtual();
    const t = clock.getTime();

    // Xem thử: tự dừng khi hết bài (audio thật thì đã có sự kiện 'ended').
    if (clock.mode === 'virtual' && t > lastTime + 3) {
      clock.endVirtual(); // kết thúc hẳn -> "Xem thử" lần sau sẽ chạy lại từ đầu
      setStatus('■ Hết bài (xem thử). Bấm "Xem thử" để chạy lại.');
      setLine(-1, true);
      rafId = null;
      return;
    }

    const idx = findActiveIndex(t);
    if (idx !== currentIndex) {
      // seek/nhảy nhiều dòng -> hiện ngay, không animation vào
      const instant = seeking || idx < currentIndex || (idx - currentIndex) > 1;
      setLine(idx, instant);
    }
    updateHighlight(t);
    updateProgress(t);

    if (clock.isRunning()) rafId = requestAnimationFrame(frame);
    else rafId = null; // dừng loop khi pause/ended (tiết kiệm CPU)
  }

  function startLoop() {
    if (rafId == null) rafId = requestAnimationFrame(frame);
  }

  function resetView() {
    if (currentLineEl) { currentLineEl.remove(); currentLineEl = null; }
    currentIndex = -1; wordEls = []; wordSegs = []; wordState = [];
    updateProgress(0);
  }

  // ---------------- sự kiện audio ----------------
  audio.addEventListener('play', () => { clock.mode = 'audio'; setStatus('▶ Đang phát'); startLoop(); });
  audio.addEventListener('pause', () => { if (!audio.ended) setStatus('⏸ Tạm dừng'); });
  audio.addEventListener('ended', () => setStatus('■ Hết bài'));
  audio.addEventListener('seeking', () => { seeking = true; });
  audio.addEventListener('seeked', () => {
    seeking = false;
    const t = clock.getTime();
    setLine(findActiveIndex(t), true); // snap đúng dòng, không animation
    updateHighlight(t);
    updateProgress(t);
  });

  // ---------------- nút điều khiển ----------------
  playBtn.addEventListener('click', () => {
    clock.mode = 'audio';
    audio.play().catch((err) => {
      setStatus('Chưa phát được (' + err.name + '). Hãy bấm "Chọn nhạc…" hoặc "Xem thử (không nhạc)".');
    });
  });

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    audio.src = URL.createObjectURL(f);
    clock.mode = 'audio';
    resetView();
    audio.play().catch(() => {});
  });

  // "Xem thử" — chạy bằng đồng hồ ảo, không cần file nhạc.
  previewBtn.addEventListener('click', () => {
    if (clock.mode === 'virtual' && clock.isRunning()) {
      clock.pauseVirtual();
      setStatus('⏸ Xem thử (tạm dừng)');
      return;
    }
    audio.pause();
    if (clock.mode !== 'virtual') {           // bắt đầu phiên xem thử mới
      resetView();
      clock.startVirtual(previewStart);
    } else {                                   // tiếp tục phiên đang tạm dừng
      clock.resumeVirtual();
    }
    setStatus('▶ Xem thử (không nhạc)');
    startLoop();
  });

  // ---------------- API debug (dùng để chụp ảnh/kiểm thử) ----------------
  KT.debug = {
    cues,
    renderAt(t) {                 // hiển thị đúng khung thời gian t (đứng yên)
      clock.mode = 'virtual';
      clock.setVirtual(t);
      clock.pauseVirtual();
      setLine(findActiveIndex(t), true);
      updateHighlight(t);
      updateProgress(t);
    }
  };

  setStatus('Sẵn sàng — bấm "Xem thử (không nhạc)" để xem ngay, hoặc thả clip.mp3 vào assets/audio/ rồi bấm Phát.');
  console.log('[KT] Đã parse', cues.length, 'cue từ LRC.');
})(window.KT);
