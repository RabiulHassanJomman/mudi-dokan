/** Spoken হ্যাঁ / না on the confirm card. Pure TS. */
import { tokenize } from '../parser/normalize';

const YES = new Set(
  ['হ্যাঁ', 'হ্যা', 'হা', 'হাঁ', 'হুম', 'জি', 'জ্বি', 'জী', 'ঠিক', 'আচ্ছা', 'ওকে', 'রাখো', 'রাখেন', 'সেভ', 'ok', 'okay', 'yes'].map(
    (w) => w.normalize('NFC'),
  ),
);
const NO = new Set(
  ['না', 'নাহ', 'নাই', 'ভুল', 'বাতিল', 'ক্যান্সেল', 'মুছো', 'মুছে', 'no', 'cancel'].map((w) => w.normalize('NFC')),
);

/** 'yes' | 'no' | null. Any "no" word wins ("ঠিক না" = no). */
export function classifyAnswer(text: string): 'yes' | 'no' | null {
  const tokens = tokenize(text);
  if (tokens.some((t) => NO.has(t))) return 'no';
  if (tokens.some((t) => YES.has(t))) return 'yes';
  return null;
}
