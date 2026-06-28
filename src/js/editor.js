/* editor.js — Tap-sync editor tạo timestamp WORD-LEVEL (Hướng 3 / Enhanced LRC).
 *
 * QUY TRÌNH: phát nhạc -> mỗi khi MỘT CHỮ bắt đầu vang lên thì gõ phím TAP (Space).
 * Editor ghi lại audio.currentTime làm thời điểm bắt đầu của chữ đó rồi nhảy sang chữ kế.
 * Xuất ra Enhanced LRC (A2) và JSON {word,start,end} — đúng định dạng player tiêu thụ.
 *
 * Mẹo độ chính xác: tay người bấm CHẬM hơn tai ~0.1–0.2s, nên có ô "Bù tay (offset)"
 * mặc định -0.12s tự trừ vào mỗi lần tap. Dùng "Lặp dòng" + tốc độ 0.75x để chỉnh kỹ.
 */
(function () {
  const cues = window.KT.parseLRC(window.KT.RAW_LRC);
  const LS_KEY = 'kte_remain_v1';

  // --- dựng các dòng có thể chỉnh (bỏ dòng rỗng, nhưng dùng time của nó làm mốc kết thúc) ---
  const lines = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const end = i + 1 < cues.length ? cues[i + 1].time : c.time + 4;
    if (!c.text) continue;
    lines.push({
      lineStart: c.time,
      lineEnd: end,
      words: c.text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, start: null })),
    });
  }

  // --- DOM ---
  const audio = document.getElementById('audio');
  const fileInput = document.getElementById('fileInput');
  const lyricsEl = document.getElementById('lyrics');
  const statsEl = document.getElementById('stats');
  const offsetInput = document.getElementById('offset');
  const speedSel = document.getElementById('speed');
  const loopChk = document.getElementById('loopline');
  const outEl = document.getElementById('output');
  const nowLineEl = document.getElementById('nowline');

  // --- con trỏ "chữ kế tiếp cần chấm" ---
  let pi = 0, wi = 0;

  // ---------- render ----------
  const wordEls = []; // wordEls[li][wj] = span
  function buildDOM() {
    lyricsEl.innerHTML = '';
    lines.forEach((line, li) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.li = li;
      const arr = [];
      line.words.forEach((w, wj) => {
        const s = document.createElement('span');
        s.className = 'w';
        s.textContent = w.text;
        s.title = 'Click để chọn lại chữ này (và seek nhạc tới đó)';
        s.addEventListener('click', () => selectWord(li, wj));
        row.appendChild(s);
        row.appendChild(document.createTextNode(' '));
        arr.push(s);
      });
      wordEls.push(arr);
      lyricsEl.appendChild(row);
    });
    refresh();
  }

  function fmt(t) {
    if (t == null) return '–';
    const m = Math.floor(t / 60);
    const s = (t - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  // cập nhật class trạng thái từng chữ + stats + dòng hiện tại
  function refresh() {
    let stamped = 0, total = 0;
    lines.forEach((line, li) => {
      line.words.forEach((w, wj) => {
        total++;
        const el = wordEls[li][wj];
        el.classList.remove('done', 'cursor');
        if (w.start != null) { el.classList.add('done'); stamped++; }
        if (li === pi && wj === wi) el.classList.add('cursor');
      });
      const row = lyricsEl.children[li];
      row.classList.toggle('active', li === pi);
    });
    statsEl.textContent = stamped + '/' + total + ' chữ đã chấm';
    const cur = lines[pi];
    nowLineEl.textContent = cur
      ? 'Dòng ' + (pi + 1) + '/' + lines.length + ' — "' + cur.words.map((w) => w.text).join(' ') + '"'
      : '✅ Xong tất cả các chữ.';
    // cuộn con trỏ vào tầm nhìn
    const curEl = lines[pi] && wordEls[pi][wi];
    if (curEl) curEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------- thao tác chính ----------
  function tap() {
    if (pi >= lines.length) return;
    const off = parseFloat(offsetInput.value) || 0;
    lines[pi].words[wi].start = Math.max(0, audio.currentTime + off);
    advance();
    save();
    refresh();
  }

  function advance() {
    wi++;
    if (wi >= lines[pi].words.length) { pi++; wi = 0; }
  }

  function undo() {
    // lùi con trỏ 1 chữ rồi xoá mốc của chữ đó
    if (pi === 0 && wi === 0) return;
    wi--;
    if (wi < 0) { pi--; wi = lines[pi].words.length - 1; }
    lines[pi].words[wi].start = null;
    save();
    refresh();
  }

  function selectWord(li, wj) {
    pi = li; wi = wj;
    const w = lines[li].words[wj];
    audio.currentTime = w.start != null ? w.start : lines[li].lineStart;
    refresh();
  }

  // ---------- audio controls ----------
  function playPause() { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
  function replayLine() {
    if (!lines[pi]) return;
    audio.currentTime = Math.max(0, lines[pi].lineStart - 0.3);
    audio.play().catch(() => {});
  }
  function seekBy(d) { audio.currentTime = Math.max(0, audio.currentTime + d); }
  function applySpeed() { audio.playbackRate = parseFloat(speedSel.value); }

  // lặp trong phạm vi dòng hiện tại (để tap đi tap lại cho chuẩn)
  audio.addEventListener('timeupdate', () => {
    if (!loopChk.checked || !lines[pi]) return;
    if (audio.currentTime > lines[pi].lineEnd + 0.2) {
      audio.currentTime = Math.max(0, lines[pi].lineStart - 0.3);
    }
  });

  // live highlight theo nhạc (chỉ trên các chữ đã chấm)
  function liveLoop() {
    const t = audio.currentTime;
    // gom toàn bộ start để tìm chữ đang vang
    let activeEl = null;
    for (let li = 0; li < lines.length; li++) {
      for (let wj = 0; wj < lines[li].words.length; wj++) {
        const w = lines[li].words[wj];
        if (w.start != null && t >= w.start) activeEl = wordEls[li][wj];
      }
    }
    wordEls.forEach((arr) => arr.forEach((el) => el.classList.remove('singing')));
    if (activeEl) activeEl.classList.add('singing');
    requestAnimationFrame(liveLoop);
  }

  // ---------- lưu / nạp localStorage ----------
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        pi, wi, starts: lines.map((l) => l.words.map((w) => w.start)),
      }));
    } catch (e) {}
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d.starts || d.starts.length !== lines.length) return false;
      lines.forEach((l, li) => {
        if (!d.starts[li] || d.starts[li].length !== l.words.length) return;
        l.words.forEach((w, wj) => { w.start = d.starts[li][wj]; });
      });
      pi = d.pi || 0; wi = d.wi || 0;
      return true;
    } catch (e) { return false; }
  }
  function clearSaved() {
    localStorage.removeItem(LS_KEY);
    lines.forEach((l) => l.words.forEach((w) => { w.start = null; }));
    pi = 0; wi = 0; refresh(); outEl.value = '';
  }

  // ---------- export ----------
  // end của mỗi chữ = start của chữ kế (toàn cục); chữ cuối dòng = lineEnd nếu không có chữ kế.
  function computeEnds() {
    const flat = [];
    lines.forEach((l, li) => l.words.forEach((w, wj) => flat.push({ w, li, wj })));
    return lines.map((l, li) => l.words.map((w, wj) => {
      // tìm chữ ĐÃ CHẤM kế tiếp (toàn cục)
      let end = l.lineEnd;
      const idx = flat.findIndex((f) => f.li === li && f.wj === wj);
      for (let k = idx + 1; k < flat.length; k++) {
        if (flat[k].w.start != null) { end = flat[k].w.start; break; }
      }
      return end;
    }));
  }

  function toJSON() {
    const ends = computeEnds();
    return JSON.stringify(lines.map((l, li) => ({
      lineStart: l.words[0] && l.words[0].start != null ? l.words[0].start : l.lineStart,
      lineEnd: l.lineEnd,
      words: l.words.map((w, wj) => ({
        word: w.text,
        start: w.start,
        end: w.start != null ? +ends[li][wj].toFixed(2) : null,
      })),
    })), null, 2);
  }

  function toEnhancedLRC() {
    // [mm:ss.xx]<mm:ss.xx>w1 <mm:ss.xx>w2 ...
    return lines.map((l) => {
      const lineStart = l.words[0] && l.words[0].start != null ? l.words[0].start : l.lineStart;
      const body = l.words.map((w) => '<' + fmtLRC(w.start != null ? w.start : lineStart) + '>' + w.text).join(' ');
      return '[' + fmtLRC(lineStart) + ']' + body;
    }).join('\n');
  }
  function fmtLRC(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }
  function copy(text) {
    outEl.value = text;
    outEl.select();
    try { navigator.clipboard.writeText(text); } catch (e) { document.execCommand('copy'); }
  }

  // ---------- bind nút + phím ----------
  document.getElementById('btnPlay').addEventListener('click', playPause);
  document.getElementById('btnTap').addEventListener('click', tap);
  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnReplay').addEventListener('click', replayLine);
  document.getElementById('btnJSON').addEventListener('click', () => copy(toJSON()));
  document.getElementById('btnLRC').addEventListener('click', () => copy(toEnhancedLRC()));
  document.getElementById('btnDlJSON').addEventListener('click', () => download('remain.word.json', toJSON()));
  document.getElementById('btnDlLRC').addEventListener('click', () => download('remain.enhanced.lrc', toEnhancedLRC()));
  document.getElementById('btnClear').addEventListener('click', () => { if (confirm('Xoá toàn bộ mốc đã chấm?')) clearSaved(); });
  speedSel.addEventListener('change', applySpeed);
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) audio.src = URL.createObjectURL(f);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    switch (e.code) {
      case 'Space':      e.preventDefault(); tap(); break;       // TAP
      case 'Backspace':  e.preventDefault(); undo(); break;      // hoàn tác
      case 'KeyP':       e.preventDefault(); playPause(); break; // phát/dừng
      case 'KeyR':       e.preventDefault(); replayLine(); break;// nghe lại dòng
      case 'ArrowLeft':  e.preventDefault(); seekBy(-2); break;
      case 'ArrowRight': e.preventDefault(); seekBy(2); break;
    }
  });

  // ---------- init ----------
  applySpeed();
  buildDOM();
  if (load()) { refresh(); statsEl.textContent += ' (đã nạp bản lưu)'; }
  requestAnimationFrame(liveLoop);
})();
