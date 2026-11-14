import { backupWords, bytesBn, driveStateBn, driveWords, whenBn } from '../words';

const base = { signedIn: true, access: true, online: true, wifi: false, wifiOnly: false, pending: 0, lastUploadAt: null, usageBytes: null };

describe('Drive words', () => {
  it('sizes', () => {
    expect(bytesBn(0)).toBe('১ কেবি');
    expect(bytesBn(45_000)).toBe('৪৫ কেবি');
    expect(bytesBn(1_300_000)).toBe('১.৩ এমবি');
    expect(bytesBn(2_500_000_000)).toBe('২.৫ জিবি');
  });

  it('state, most important first', () => {
    expect(driveStateBn({ ...base, signedIn: false })).toMatch(/ঢোকা নেই/);
    expect(driveStateBn({ ...base, access: false })).toMatch(/Drive চালু নেই/);
    expect(driveStateBn({ ...base, online: false, pending: 2 })).toMatch(/ইন্টারনেট নেই/);
    expect(driveStateBn({ ...base, wifiOnly: true, pending: 2 })).toMatch(/Wi-Fi/);
    expect(driveStateBn({ ...base, wifiOnly: true, wifi: true, pending: 2 })).toBe('অডিও পাঠানো হচ্ছে');
    expect(driveStateBn(base)).toBe('সব অডিও Drive এ আছে');
  });

  it('🔊 reads usage, pending, last upload and the Wi-Fi setting', () => {
    const now = 1_763_000_000_000;
    expect(driveWords({ ...base, pending: 3, usageBytes: 2_000_000, lastUploadAt: now - 5 * 60_000 }, now)).toBe(
      'অডিও পাঠানো হচ্ছে। Drive এ অ্যাপের জায়গা ২ এমবি। ৩টা অডিও পাঠানো বাকি। শেষ পাঠানো ৫ মিনিট আগে। মোবাইল ডাটাতেও পাঠায়।',
    );
  });

  it('backup line', () => {
    expect(backupWords(null, false)).toMatch(/^এখনো কোনো ব্যাকআপ নেই। .*শেয়ার/);
    const at = new Date(2026, 10, 14, 21, 5).getTime();
    expect(whenBn(at)).toBe('১৪ নভেম্বর, রাত ৯:০৫');
    expect(backupWords(at, true, at + 3_600_000)).toBe('শেষ ব্যাকআপ ১ ঘণ্টা আগে, ১৪ নভেম্বর, রাত ৯:০৫। প্রতি রাতে আর দিন শেষ করলে Drive এ ব্যাকআপ হয়।');
  });
});
