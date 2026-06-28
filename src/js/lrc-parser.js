/* lrc-parser.js
 * Parse chuỗi .lrc -> mảng cue { time, text } đã sort theo thời gian.
 * - Bỏ qua tag metadata ([ar:], [ti:], [al:]...) vì không phải mm:ss.
 * - Hỗ trợ nhiều timestamp trên một dòng: [t1][t2] text.
 * - Giữ lại cue có text rỗng (dùng làm mốc "dọn màn hình" cuối bài).
 */
window.KT = window.KT || {};
(function (KT) {
  function parseLRC(raw) {
    const lines = raw.split(/\r?\n/);
    const timeTag = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    const cues = [];

    for (const line of lines) {
      // Lấy phần text bằng cách xoá mọi timestamp ở đầu dòng.
      const text = line.replace(timeTag, '').trim();

      // Thu thập tất cả timestamp trên dòng này.
      timeTag.lastIndex = 0;
      let m;
      while ((m = timeTag.exec(line)) !== null) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        let frac = 0;
        if (m[3] != null) {
          // ".45" -> 0.45 ; ".450" -> 0.450  (chia theo số chữ số)
          frac = parseInt(m[3], 10) / Math.pow(10, m[3].length);
        }
        cues.push({ time: min * 60 + sec + frac, text });
      }
    }

    // Luôn sort theo thời gian — KHÔNG tin thứ tự trong file.
    cues.sort((a, b) => a.time - b.time);
    return cues;
  }

  KT.parseLRC = parseLRC;
})(window.KT);
