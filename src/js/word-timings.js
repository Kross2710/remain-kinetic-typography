/* word-timings.js
 * Trả về timing từng chữ cho MỘT dòng: [{ word, start, end }].
 *
 * Ưu tiên 1 (Hướng 3): nếu có KT.WORD_DATA (timestamp thật bạn chấm ở editor.html)
 *   -> khớp dòng theo TEXT + thời gian gần nhất (để câu lặp như "But I will remain, love"
 *      xuất hiện 3 lần vẫn lấy đúng mốc của lần tương ứng), rồi LÀM SẠCH:
 *      ép start không giảm dần (monotonic) và end >= start -> tránh giật do mốc lệch.
 * Ưu tiên 2 (fallback Hướng 2): chưa có mốc thật -> chia thời lượng dòng theo trọng số ký tự.
 *
 * 👉 Animation & vòng lặp sync KHÔNG phải đổi gì khi bật/tắt word-level.
 */
window.KT = window.KT || {};
(function (KT) {
  function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  // Lập chỉ mục WORD_DATA theo text đã chuẩn hoá (một text có thể ứng nhiều mục nếu câu lặp).
  let _index = null;
  function buildIndex() {
    _index = new Map();
    const data = KT.WORD_DATA || [];
    data.forEach((line) => {
      const key = norm(line.words.map((w) => w.word).join(' '));
      if (!_index.has(key)) _index.set(key, []);
      _index.get(key).push(line);
    });
  }

  // Tìm mục word-data khớp text, và (nếu trùng text) chọn mục có lineStart gần lineStart truy vấn nhất.
  function lookup(text, lineStart) {
    if (!KT.WORD_DATA || !KT.WORD_DATA.length) return null;
    if (!_index) buildIndex();
    const cands = _index.get(norm(text));
    if (!cands || !cands.length) return null;
    let best = cands[0], bestD = Infinity;
    for (const c of cands) {
      const base = (c.words[0] && c.words[0].start != null) ? c.words[0].start : c.lineStart;
      const d = Math.abs(base - lineStart);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Ép monotonic + end hợp lệ (updateHighlight dựa vào start tăng dần).
  function sanitize(words, lineEnd) {
    let prev = -Infinity;
    const out = words.map((w) => {
      let start = (w.start != null) ? w.start : prev;
      if (start < prev) start = prev;        // không lùi về trước
      prev = start;
      let end = (w.end != null) ? w.end : start;
      if (end < start) end = start;
      return { word: w.word, start: start, end: end };
    });
    // chốt end của chữ cuối không vượt quá cuối dòng (nếu biết)
    if (out.length && lineEnd != null && out[out.length - 1].end > lineEnd + 2) {
      out[out.length - 1].end = lineEnd;
    }
    return out;
  }

  function getWordTimings(text, lineStart, lineEnd) {
    // --- Hướng 3: dùng mốc thật nếu có ---
    const hit = lookup(text, lineStart);
    if (hit) return sanitize(hit.words, lineEnd);

    // --- Fallback Hướng 2: chia đều theo trọng số ký tự ---
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const total = Math.max(0.001, lineEnd - lineStart);
    const weights = words.map((w) => w.length + 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    let acc = lineStart;
    return words.map((w, i) => {
      const dur = (weights[i] / sum) * total;
      const seg = { word: w, start: acc, end: acc + dur };
      acc += dur;
      return seg;
    });
  }

  KT.getWordTimings = getWordTimings;
})(window.KT);
