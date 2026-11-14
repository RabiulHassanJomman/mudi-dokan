/**
 * One customer per line: name + optional phone + anything else as a note. Pure TS.
 *   "করিম ভাই, 01711-123456 মসজিদের পাশে" → করিম · 01711123456 · "ভাই · মসজিদের পাশে"
 */
import { formatNumber } from '../lib/bn';
import type { ImportSpec, Problem } from './importer';

export interface CustomerLine {
  name: string;
  /** 01XXXXXXXXX, or null. */
  phone: string | null;
  note: string | null;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const asciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/**
 * A Bangladeshi mobile number → 01XXXXXXXXX (operator digit 3–9), else null.
 * Takes +880 / 880 / 00880, Bangla digits, spaces, dashes, dots, brackets.
 */
export function parseBdPhone(raw: string): string | null {
  let d = asciiDigits(raw).replace(/\D/g, '');
  if (d.startsWith('00880')) d = d.slice(4);
  else if (d.startsWith('880')) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

/** Said before or after a name as respect: kept as a note, not in the name. */
const HONORIFICS = new Set([
  'ভাই', 'ভাইয়া', 'ভাইজান', 'আপা', 'আপু', 'আপুমনি', 'বোন', 'ভাবি', 'ভাবী', 'চাচা', 'চাচী', 'চাচি', 'খালা', 'খালু',
  'মামা', 'মামী', 'মামি', 'ফুপু', 'ফুফু', 'কাকা', 'কাকী', 'কাকি', 'দাদা', 'দাদী', 'দাদি', 'দিদি', 'নানা', 'নানী', 'নানি',
  'সাহেব', 'সাব', 'স্যার', 'ম্যাডাম',
  'bhai', 'vai', 'bhaiya', 'vaiya', 'apa', 'apu', 'bhabi', 'vabi', 'chacha', 'chachi', 'khala', 'mama', 'mami', 'kaka',
  'dada', 'didi', 'saheb', 'sahib', 'shaheb', 'sir', 'uncle', 'aunty', 'auntie', 'mr', 'mrs', 'ms', 'madam',
]);
const isHonorific = (w: string) => HONORIFICS.has(w.toLowerCase().replace(/[.,]$/, '').replace(/^-/, ''));

/** A run that looks like a phone attempt: 3+ digits with separators, maybe a leading +. */
const PHONE_RUN = /\+?[\d০-৯][\d০-৯\s\-.()]*[\d০-৯]/;
const SEP = /^[\s,;:|/\t\-–]+|[\s,;:|/\t\-–]+$/g;

function splitNameNote(text: string): { name: string; notes: string[] } {
  const notes: string[] = [];
  // (…) is a note
  let t = text.replace(/[(（]([^)）]*)[)）]/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });
  // a comma/tab/semicolon ends the name; the rest is a note
  const cut = t.search(/[,;\t|]/);
  if (cut >= 0) {
    const rest = t.slice(cut + 1).replace(SEP, '');
    t = t.slice(0, cut);
    if (rest) notes.push(rest);
  }
  const words = t.replace(SEP, '').split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  const honor: string[] = [];
  for (const w of words) (isHonorific(w) ? honor : kept).push(isHonorific(w) ? w.replace(/[.,]$/, '').replace(/^-/, '') : w);
  return { name: kept.join(' '), notes: [...honor, ...notes] };
}

export function parseCustomerLine(raw: string): { value: CustomerLine; problems: Problem[] } {
  const line = raw.normalize('NFC').trim();
  const problems: Problem[] = [];
  let phone: string | null = null;
  let before = line;
  const after: string[] = [];
  const m = PHONE_RUN.exec(line);
  if (m && asciiDigits(m[0]).replace(/\D/g, '').length >= 3) {
    phone = parseBdPhone(m[0]);
    before = line.slice(0, m.index);
    const tail = line.slice(m.index + m[0].length).replace(SEP, '');
    if (!phone) {
      problems.push('bad_phone');
      after.push(m[0].trim());
    }
    if (tail) after.push(tail);
  }
  const { name, notes } = splitNameNote(before);
  if (!name) problems.unshift('no_name');
  const note = [...notes, ...after].join(' · ') || null;
  return { value: { name, phone, note }, problems };
}

export const customerSpec: ImportSpec<CustomerLine> = {
  parseLine: parseCustomerLine,
  nameOf: (v) => v.name,
  phoneOf: (v) => v.phone,
};

/** "১২ জন ক্রেতা যোগ করব। ঠিক আছে?" */
export const importReadback = (n: number, what = 'ক্রেতা') => `${formatNumber(n)} জন ${what} যোগ করব। ঠিক আছে?`;
