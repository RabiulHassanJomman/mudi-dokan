import { nfc, wordMap } from './util';

/** Spelling variants STT commonly produces → canonical keyword spelling. */
const VARIANTS = wordMap<string>({
  বাকী: 'বাকি',
  বাকীতে: 'বাকিতে',
  বেঁচা: 'বেচা',
  বিক্রী: 'বিক্রি',
  পরিসোধ: 'পরিশোধ',
  স্টোক: 'স্টক',
});

/** Text → single-spaced, NFC, ASCII digits, no punctuation. */
export function normalizeText(text: string): string {
  let s = nfc(text).toLowerCase();
  s = s.replace(/[​-‍﻿]/g, ''); // zero-width chars from keyboards/STT
  s = s.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));
  s = s.replace(/(\d),(?=\d)/g, '$1'); // 1,500 and 1,50,000
  s = s.replace(/৳/g, ' টাকা ');
  s = s.replace(/(\d)\.(\d)/g, '$1\u0001$2'); // protect decimals
  s = s.replace(/[.?!।॥,;:"'`’‘“”()[\]{}\-–—/\\|*+=]/g, ' ');
  s = s.replace(/\u0001/g, '.');
  // split fused digit/word: "২কেজি" → "2 কেজি", "৳১০০" → "টাকা 100"
  s = s.replace(/(\d)(?=[^\d\s.])/g, '$1 ').replace(/([^\d\s.])(?=\d)/g, '$1 ');
  return s.replace(/\s+/g, ' ').trim();
}

export function tokenize(text: string): string[] {
  const s = normalizeText(text);
  if (!s) return [];
  return s.split(' ').map((t) => VARIANTS.get(t) ?? t);
}
