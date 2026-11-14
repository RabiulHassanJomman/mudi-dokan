import {
  DEVICE_NAME_MAX,
  businessDate,
  cleanDeviceName,
  nameFromSpeech,
  newSetupDraft,
  setupProblems,
  setupReadback,
  type SetupDraft,
} from '../setup';

const ok: SetupDraft = { shopName: 'রহমান স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 };

describe('setup', () => {
  it('a new phone: no name yet, role কর্মচারী (no guess from the name)', () => {
    expect(newSetupDraft()).toEqual({ shopName: '', deviceName: '', role: 'staff', openingCashPoisha: null });
  });

  it('"আপনার নাম": trimmed, one space, at most 30 characters', () => {
    expect(DEVICE_NAME_MAX).toBe(30);
    expect(cleanDeviceName('  রফিক   উদ্দিন ')).toBe('রফিক উদ্দিন');
    expect([...cleanDeviceName('ক'.repeat(40))]).toHaveLength(30);
  });

  it('a name over 30 characters is a problem (the box also stops at 30)', () => {
    expect(setupProblems({ ...ok, deviceName: 'ক'.repeat(31) })).toEqual(['device_name']);
    expect(setupProblems({ ...ok, deviceName: 'ক'.repeat(30) })).toEqual([]);
  });

  it('a spoken name: "আমার নাম …" and the full stop come off', () => {
    expect(nameFromSpeech('আমার নাম রফিক')).toBe('রফিক');
    expect(nameFromSpeech('আমার নাম হলো রফিক উদ্দিন।')).toBe('রফিক উদ্দিন');
    expect(nameFromSpeech('আমি রফিক বলছি')).toBe('রফিক');
    expect(nameFromSpeech('রফিক')).toBe('রফিক');
    expect(nameFromSpeech('   ')).toBe('');
  });

  it('everything filled → no problems; ৳ ০ opening cash is fine', () => {
    expect(setupProblems(ok)).toEqual([]);
    expect(setupProblems({ ...ok, openingCashPoisha: 0 })).toEqual([]);
  });

  it('lists what is missing', () => {
    expect(setupProblems({ shopName: '  ', deviceName: '', role: null, openingCashPoisha: null })).toEqual([
      'shop_name',
      'device_name',
      'role',
      'opening_cash',
    ]);
  });

  it('readback before saving (TTS + the confirm sheet)', () => {
    expect(setupReadback(ok)).toBe('দোকান: রহমান স্টোর। আপনার নাম: আব্বু, মালিক। ক্যাশে ৫,০০০ টাকা। ঠিক আছে?');
    expect(setupReadback({ ...ok, deviceName: 'কর্মচারী ১', role: 'staff', openingCashPoisha: 0 })).toBe(
      'দোকান: রহমান স্টোর। আপনার নাম: কর্মচারী ১, কর্মচারী। ক্যাশে ০ টাকা। ঠিক আছে?',
    );
  });

  it('business date is the shop-local calendar day', () => {
    expect(businessDate(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
    expect(businessDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});

describe('setup on a phone joining a shop that is already in the cloud', () => {
  it('only this phone’s name and role are asked; shop name and cash are not', () => {
    const joined = { shopName: '', deviceName: 'রফিক', role: 'staff' as const, openingCashPoisha: null };
    expect(setupProblems(joined, { joinedShop: true })).toEqual([]);
    expect(setupProblems({ ...joined, deviceName: '' }, { joinedShop: true })).toEqual(['device_name']);
    expect(setupProblems(joined)).toEqual(['shop_name', 'opening_cash']);
  });

  it('the readback leaves out shop and cash', () => {
    expect(setupReadback({ shopName: 'রহিম স্টোর', deviceName: 'রফিক', role: 'staff', openingCashPoisha: null }, { joinedShop: true })).toBe(
      'দোকান: রহিম স্টোর। আপনার নাম: রফিক, কর্মচারী। ঠিক আছে?',
    );
  });
});
