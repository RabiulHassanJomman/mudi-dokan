import { DEVICE_PRESETS, businessDate, defaultRole, setupProblems, setupReadback, type SetupDraft } from '../setup';

const ok: SetupDraft = { shopName: 'রহমান স্টোর', deviceName: 'আব্বু', role: 'owner', openingCashPoisha: 500000 };

describe('setup', () => {
  it('device name chips from the design', () => {
    expect(DEVICE_PRESETS).toEqual(['আব্বু', 'আম্মু', 'কর্মচারী ১']);
  });

  it('role defaults from the name chip; a new name has none until chosen', () => {
    expect(defaultRole('আব্বু')).toBe('owner');
    expect(defaultRole('আম্মু')).toBe('owner');
    expect(defaultRole('কর্মচারী ১')).toBe('staff');
    expect(defaultRole('কর্মচারী ২')).toBe('staff');
    expect(defaultRole('রনি')).toBeNull();
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
    expect(setupReadback(ok)).toBe('দোকান: রহমান স্টোর। এই ফোন: আব্বু, মালিক। ক্যাশে ৫,০০০ টাকা। ঠিক আছে?');
    expect(setupReadback({ ...ok, deviceName: 'কর্মচারী ১', role: 'staff', openingCashPoisha: 0 })).toBe(
      'দোকান: রহমান স্টোর। এই ফোন: কর্মচারী ১, কর্মচারী। ক্যাশে ০ টাকা। ঠিক আছে?',
    );
  });

  it('business date is the shop-local calendar day', () => {
    expect(businessDate(new Date(2026, 10, 14, 23, 59))).toBe('2026-11-14');
    expect(businessDate(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});
