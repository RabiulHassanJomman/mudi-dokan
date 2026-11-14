import { agoBn, syncWords } from '../words';

const NOW = 1_794_000_000_000;

describe('sync words', () => {
  it('agoBn', () => {
    expect(agoBn(null, NOW)).toBe('কখনো না');
    expect(agoBn(NOW - 5_000, NOW)).toBe('এইমাত্র');
    expect(agoBn(NOW - 5 * 60_000, NOW)).toBe('৫ মিনিট আগে');
    expect(agoBn(NOW - 3 * 3_600_000, NOW)).toBe('৩ ঘণ্টা আগে');
    expect(agoBn(NOW - 49 * 3_600_000, NOW)).toBe('২ দিন আগে');
  });

  it('syncWords', () => {
    expect(
      syncWords(
        { phase: 'idle', email: 'shop@example.com', lastError: null, stats: { lastSyncAt: NOW - 120_000, pending: 3, waiting: 0, writesToday: 120, readsToday: 40 } },
        NOW,
      ),
    ).toBe('সিঙ্ক ঠিক আছে। অ্যাকাউন্ট shop@example.com। শেষ সিঙ্ক ২ মিনিট আগে। ৩টা হিসাব পাঠানো বাকি। আজ পাঠানো ১২০, সীমা ১৮,০০০।');
    expect(syncWords({ phase: 'signed_out', email: null, lastError: null, stats: null }, NOW)).toBe('Google অ্যাকাউন্টে ঢোকা নেই — সিঙ্ক বন্ধ।');
  });
});
