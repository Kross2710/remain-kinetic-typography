// Port từ src/js/sections.js — cấu trúc bài + bảng màu theo đoạn.
export type Palette = { au1: string; au2: string; accent: string };
export type SectionKind = 'intro' | 'verse' | 'chorus' | 'bridge';
export type Section = { name: string; kind: SectionKind; end: number };

export const PALETTE: Record<SectionKind, Palette> = {
  intro: { au1: '#1B2747', au2: '#1F4A4A', accent: '#CBD8E6' },
  verse: { au1: '#2B3A67', au2: '#1F5C5A', accent: '#BFE3DA' },
  chorus: { au1: '#6E3B4E', au2: '#C98A5E', accent: '#F2C98A' },
  bridge: { au1: '#3A3450', au2: '#5A4A6E', accent: '#C8B6E0' },
};

export const SECTIONS: Section[] = [
  { name: '', kind: 'intro', end: 16.31 },
  { name: 'Verse', kind: 'verse', end: 42.86 },
  { name: 'Chorus', kind: 'chorus', end: 67.42 },
  { name: 'Verse', kind: 'verse', end: 94.45 },
  { name: 'Chorus', kind: 'chorus', end: 118.25 },
  { name: 'Bridge', kind: 'bridge', end: 145.39 },
  { name: 'Chorus', kind: 'chorus', end: 999 },
];

export function sectionAt(t: number): Section {
  for (const s of SECTIONS) if (t < s.end) return s;
  return SECTIONS[SECTIONS.length - 1];
}
