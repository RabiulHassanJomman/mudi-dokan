/** বাকি tab › বলুন: a customer's name alone (or "…র হিসাব", "…র বাকি কত") opens their summary. */
import { customerLookup } from '../keyboard';

const known = ['সাজু', 'শোয়েব', 'তিন তলার মহিলা', 'করিম', 'করিমুল'];
const aliases = { শাহজু: 'সাজু' };

describe('a name said in the বাকি tab → that customer', () => {
  it('the name alone', () => {
    expect(customerLookup('সাজু', known, aliases)).toBe('সাজু');
    expect(customerLookup(' করিম। ', known, aliases)).toBe('করিম');
  });

  it('with হিসাব / বাকি কত / খাতা দেখাও / honorifics and case endings', () => {
    expect(customerLookup('সাজুর হিসাব', known, aliases)).toBe('সাজু');
    expect(customerLookup('সাজুর বাকি কত', known, aliases)).toBe('সাজু');
    expect(customerLookup('শোয়েব ভাইয়ের খাতা দেখাও', known, aliases)).toBe('শোয়েব');
    expect(customerLookup('করিমের কাছে কত পাবো', known, aliases)).toBe('করিম');
    expect(customerLookup('করিম সাহেবের হিসাবটা দেখি', known, aliases)).toBe('করিম');
  });

  it('a name with a number word in it, an alias, a small mishearing', () => {
    expect(customerLookup('তিন তলার মহিলা', known, aliases)).toBe('তিন তলার মহিলা');
    expect(customerLookup('শাহজুর হিসাব', known, aliases)).toBe('সাজু');
    expect(customerLookup('শোয়াইব', known, aliases)).toBe('শোয়েব');
  });

  it('not a lookup: an entry, an amount, an unknown name, nothing', () => {
    expect(customerLookup('সাজু ৫০০', known, aliases)).toBeNull();
    expect(customerLookup('সাজু জমা দিয়েছে', known, aliases)).toBeNull();
    expect(customerLookup('সাজু বাকি নিল', known, aliases)).toBeNull();
    expect(customerLookup('রফিক', known, aliases)).toBeNull();
    expect(customerLookup('হিসাব দেখাও', known, aliases)).toBeNull();
    expect(customerLookup('', known, aliases)).toBeNull();
    expect(customerLookup('সাজু', [], {})).toBeNull();
  });
});
