/**
 * Where the numbers are in a string, so they get their own font (<Num>). Pure TS.
 * A number = Bangla digits with the ৳ sign and the commas / point inside it:
 * "৳ ৮,২৩০" → ["৳", " ", "৮,২৩০"], "২.৫ কেজি" → ["২.৫", " কেজি"].
 */
export interface Run {
  text: string;
  /** true = a number (own font). */
  num: boolean;
}

const NUMBER = /[০-৯৳]+(?:[,.][০-৯]+)*/g;

export function splitNumbers(text: string): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const m of text.matchAll(NUMBER)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), num: false });
    out.push({ text: m[0], num: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), num: false });
  return out;
}
