/** অ্যাপ শেখা: the first-time tutorial pages. */
import { TUTORIAL_PAGES, tutorialPosition, tutorialSpeech } from '../tutorial';
import { readKeyboardText } from '../keyboard';
import { parseFixed } from '../../parser/fixed';

describe('tutorial pages', () => {
  it('covers 🎤, the four formats, হ্যাঁ/না, the মাল / বাকি / ক্যাশ screens, and how to see it again', () => {
    expect(TUTORIAL_PAGES.map((p) => p.key)).toEqual([
      'welcome', 'mic', 'cash_sale', 'baki', 'joma', 'purchase', 'confirm', 'stock_tab', 'baki_tab', 'cash', 'done',
    ]);
  });

  it('keys are unique; every page has a title and at least one line', () => {
    expect(new Set(TUTORIAL_PAGES.map((p) => p.key)).size).toBe(TUTORIAL_PAGES.length);
    for (const p of TUTORIAL_PAGES) {
      expect(p.title.trim()).not.toBe('');
      expect(p.lines.length).toBeGreaterThan(0);
    }
  });

  it('one page per spoken format, each example reads as its format and is complete', () => {
    const withExample = TUTORIAL_PAGES.filter((p) => p.example);
    expect(withExample.map((p) => p.kind).sort()).toEqual(['baki', 'cash_sale', 'joma', 'purchase']);
    for (const p of withExample) {
      const r = parseFixed(p.example!);
      expect({ key: p.key, kind: r.kind, problems: r.problems }).toEqual({ key: p.key, kind: p.kind, problems: [] });
      // and the way বলুন reads it (spelling fixes, customer match) agrees
      expect(readKeyboardText(p.example!, {})).toMatchObject({ kind: p.kind, problems: [] });
    }
  });

  it('the examples are the ones the বলুন screen shows', () => {
    const ex = Object.fromEntries(TUTORIAL_PAGES.filter((p) => p.example).map((p) => [p.kind, p.example]));
    expect(ex).toEqual({
      cash_sale: 'নগদ বিক্রি আদা, চাল ১০০ টাকা',
      baki: 'সাজু বাকি নিয়েছে আদা, চাল, আটা ১০০ টাকা',
      joma: 'সাজু ৫০ টাকা জমা দিয়েছে',
      purchase: '১০০০ টাকার আলু কেনা হয়েছে',
    });
  });

  it('the last page says where to find it again (⚙ › অ্যাপ শেখা)', () => {
    expect(TUTORIAL_PAGES.at(-1)!.lines.join(' ')).toContain('অ্যাপ শেখা');
  });
});

describe('read aloud', () => {
  it('title, lines and the example, without emoji or quote marks', () => {
    const joma = TUTORIAL_PAGES.find((p) => p.key === 'joma')!;
    expect(tutorialSpeech(joma)).toBe(
      'জমা। বাকির টাকা ফেরত দিলে: ক্রেতার নাম, টাকা, তারপর জমা দিয়েছে। যেমন বলুন: সাজু ৫০ টাকা জমা দিয়েছে।',
    );
  });

  it('no page speaks an emoji, quote mark or a doubled ।', () => {
    for (const p of TUTORIAL_PAGES) {
      const s = tutorialSpeech(p);
      expect(s).not.toMatch(/[🔊🎤⏸▶✅⚙“”]/u);
      expect(s).not.toMatch(/।\s*।/);
      expect(s.endsWith('।')).toBe(true);
    }
  });

  it('the 🎤 page: 🎤 is said as মাইক, button names kept', () => {
    expect(tutorialSpeech(TUTORIAL_PAGES[1]!)).toBe(
      'বড় মাইক চাপুন। টুং শব্দের পর কথা বলুন। কথা থামালে কার্ড খুলবে। মাঝে থামতে বিরতি, আবার বলতে চালিয়ে যান। ইন্টারনেট লাগবে।',
    );
  });
});

describe('position', () => {
  it('Bangla digits', () => {
    expect(tutorialPosition(0)).toBe('১ / ১১');
    expect(tutorialPosition(10)).toBe('১১ / ১১');
  });
});
