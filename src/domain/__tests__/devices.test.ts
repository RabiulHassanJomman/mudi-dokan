import {
  actionQuestion,
  adminIds,
  canClaimAdmin,
  canLogOut,
  canRemoveAdmin,
  deviceCards,
  devicesReadout,
  logoutRequested,
  seenWords,
  type DeviceEvent,
  type DeviceRow,
} from '../devices';

let n = 0;
const ev = (target: string, action: DeviceEvent['action'], at: number, session: string | null = null): DeviceEvent => ({
  id: `e${++n}`,
  target_device_id: target,
  action,
  target_session: session,
  device_name: 'আব্বু',
  created_at: at,
});
const dev = (id: string, p: Partial<DeviceRow> = {}): DeviceRow => ({
  id,
  device_name: id,
  role: 'staff',
  model: 'Pixel 7',
  session_id: `s-${id}`,
  signed_in: 1,
  last_seen_at: 1000,
  updated_at: 1000,
  ...p,
});

describe('adminIds', () => {
  it('nobody is admin until a phone claims it', () => {
    expect(adminIds([]).size).toBe(0);
    expect(canClaimAdmin(adminIds([]))).toBe(true);
    expect(canClaimAdmin(adminIds([ev('pixel', 'admin_on', 1)]))).toBe(false);
  });

  it('the latest admin_on / admin_off per phone counts; logout events do not touch it', () => {
    const events = [ev('pixel', 'admin_on', 1), ev('rafiq', 'admin_on', 2), ev('rafiq', 'admin_off', 3), ev('pixel', 'logout', 4, 's1')];
    expect([...adminIds(events)]).toEqual(['pixel']);
    expect([...adminIds([...events, ev('rafiq', 'admin_on', 5)])].sort()).toEqual(['pixel', 'rafiq']);
  });

  it('events from two phones at the same ms: the larger id wins (every phone agrees)', () => {
    const a = { ...ev('rafiq', 'admin_on', 7), id: 'b' };
    const b = { ...ev('rafiq', 'admin_off', 7), id: 'a' };
    expect(adminIds([a, b]).has('rafiq')).toBe(true);
    expect(adminIds([b, a]).has('rafiq')).toBe(true);
  });

  it('the last admin cannot be removed; one of two can (itself too)', () => {
    const one = adminIds([ev('pixel', 'admin_on', 1)]);
    expect(canRemoveAdmin(one, 'pixel')).toBe(false);
    const two = adminIds([ev('pixel', 'admin_on', 1), ev('rafiq', 'admin_on', 2)]);
    expect(canRemoveAdmin(two, 'pixel')).toBe(true);
    expect(canRemoveAdmin(two, 'karim')).toBe(false); // not an admin
  });
});

describe('logoutRequested', () => {
  it('only the session the admin saw logs out; signing in again is a new session', () => {
    const events = [ev('rafiq', 'logout', 5, 's-old')];
    expect(logoutRequested(events, 'rafiq', 's-old')).toBe(true);
    expect(logoutRequested(events, 'rafiq', 's-new')).toBe(false);
    expect(logoutRequested(events, 'karim', 's-old')).toBe(false);
    expect(logoutRequested(events, 'rafiq', null)).toBe(false);
  });
});

describe('deviceCards', () => {
  it('this phone first, then signed-in phones by last seen, then the rest; states and admin marked', () => {
    const rows = [
      dev('old', { signed_in: null, last_seen_at: null, updated_at: 50 }),
      dev('karim', { signed_in: 0, last_seen_at: 9000 }),
      dev('rafiq', { last_seen_at: 3000 }),
      dev('pixel', { last_seen_at: 100 }),
      dev('salma', { last_seen_at: 5000 }),
    ];
    const events = [ev('pixel', 'admin_on', 1), ev('salma', 'logout', 2, 's-salma')];
    const cards = deviceCards(rows, events, 'pixel');
    expect(cards.map((c) => [c.id, c.state, c.isAdmin, c.isMe])).toEqual([
      ['pixel', 'in', true, true],
      ['salma', 'leaving', false, false],
      ['rafiq', 'in', false, false],
      ['karim', 'out', false, false],
      ['old', 'unknown', false, false],
    ]);
    expect(cards.find((c) => c.id === 'old')!.seenAt).toBe(50); // an old app: its row's time
    expect(cards.filter(canLogOut).map((c) => c.id)).toEqual(['rafiq']); // not itself, not leaving/out/unknown
  });

  it('a blank name shows as নাম নেই', () => {
    expect(deviceCards([dev('x', { device_name: '  ' })], [], 'y')[0]!.name).toBe('নাম নেই');
  });
});

describe('words', () => {
  it('seenWords: আজ / গতকাল / n দিন আগে / কখনো না', () => {
    const now = new Date(2026, 10, 28, 15, 0).getTime();
    expect(seenWords(new Date(2026, 10, 28, 1, 0).getTime(), now)).toBe('আজ');
    expect(seenWords(new Date(2026, 10, 27, 23, 0).getTime(), now)).toBe('গতকাল');
    expect(seenWords(new Date(2026, 10, 24, 12, 0).getTime(), now)).toBe('৪ দিন আগে');
    expect(seenWords(null, now)).toBe('কখনো না');
  });

  it('every action asks with the phone name', () => {
    expect(actionQuestion('admin_on', 'রফিক')).toMatch(/^রফিক-এর ফোন অ্যাডমিন হবে/);
    expect(actionQuestion('admin_off', 'রফিক')).toMatch(/আর অ্যাডমিন থাকবে না/);
    expect(actionQuestion('logout', 'রফিক')).toMatch(/লগ আউট হবে, ওই ফোনের সব হিসাব মুছে যাবে/);
    expect(actionQuestion('logout', 'রফিক')).toMatch(/আগে পাঠানো হবে/);
    expect(actionQuestion('claim', '')).toMatch(/^এই ফোন অ্যাডমিন হবে/);
  });

  it('readout lists every phone and says what to do', () => {
    const cards = deviceCards([dev('pixel', { device_name: 'আব্বু' }), dev('rafiq', { device_name: 'রফিক', model: null })], [ev('pixel', 'admin_on', 1)], 'pixel');
    const t = devicesReadout(cards, true, false);
    expect(t).toContain('মোট ২টা ফোন');
    expect(t).toContain('এই ফোন, আব্বু, Pixel 7, অ্যাডমিন, চালু আছে।');
    expect(t).toContain('রফিক, চালু আছে।');
    expect(t).toMatch(/আপনি অ্যাডমিন/);
    expect(devicesReadout([], false, true)).toMatch(/আমি অ্যাডমিন হব চাপুন/);
    expect(devicesReadout([], false, false)).toMatch(/শুধু অ্যাডমিন বদলাতে পারেন/);
  });
});
