/* sections.js — bản đồ CẤU TRÚC bài hát + bảng màu theo đoạn.
 * Aurora đổi tông theo đoạn (verse lạnh / chorus ấm / bridge bầm tím),
 * và accent chữ-đang-hát rút ra từ chính tông đó. Mốc lấy từ timestamp thật.
 */
window.KT = window.KT || {};
(function (KT) {
  // au1, au2: 2 cực màu của trường aurora · accent: màu chữ đang hát
  const PALETTE = {
    intro:  { au1: '#1B2747', au2: '#1F4A4A', accent: '#CBD8E6' },
    verse:  { au1: '#2B3A67', au2: '#1F5C5A', accent: '#BFE3DA' }, // lạnh: indigo–teal
    chorus: { au1: '#6E3B4E', au2: '#C98A5E', accent: '#F2C98A' }, // ấm: mulberry–amber
    bridge: { au1: '#3A3450', au2: '#5A4A6E', accent: '#C8B6E0' }, // bầm tím–tro
  };

  const SECTIONS = [
    { name: '',       kind: 'intro',  end: 16.31 },
    { name: 'Verse',  kind: 'verse',  end: 42.86 },
    { name: 'Chorus', kind: 'chorus', end: 67.42 },
    { name: 'Verse',  kind: 'verse',  end: 94.45 },
    { name: 'Chorus', kind: 'chorus', end: 118.25 },
    { name: 'Bridge', kind: 'bridge', end: 145.39 },
    { name: 'Chorus', kind: 'chorus', end: 999 },
  ];

  function sectionAt(t) {
    for (let i = 0; i < SECTIONS.length; i++) {
      if (t < SECTIONS[i].end) return SECTIONS[i];
    }
    return SECTIONS[SECTIONS.length - 1];
  }

  KT.PALETTE = PALETTE;
  KT.sectionAt = sectionAt;
})(window.KT);
