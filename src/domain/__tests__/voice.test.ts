import { pickVoice } from '../voice';

const PIXEL = ['bn-in-x-bnd-network', 'bn-in-x-bnc-network', 'bn-BD-language', 'bn-bd-x-ban-network', 'bn-IN-language', 'bn-in-x-bnd-local', 'bn-in-x-bnc-local', 'bn-bd-x-ban-local'];

describe('the app\'s voice: male, Bangladeshi, the more natural online one when there is internet', () => {
  it('online: bn-bd-x-ban-network', () => {
    expect(pickVoice(PIXEL, true)).toBe('bn-bd-x-ban-network');
  });
  it('offline: the same voice from the phone (local)', () => {
    expect(pickVoice(PIXEL, false)).toBe('bn-bd-x-ban-local');
  });
  it('no Bangladeshi male voice: the Kolkata male one', () => {
    expect(pickVoice(['bn-in-x-bnd-network', 'bn-in-x-bnd-local', 'bn-in-x-bnc-local'], true)).toBe('bn-in-x-bnd-network');
    expect(pickVoice(['bn-in-x-bnd-local', 'bn-in-x-bnc-local'], true)).toBe('bn-in-x-bnd-local');
  });
  it('online voice listed but offline and no local copy: next choice', () => {
    expect(pickVoice(['bn-bd-x-ban-network', 'bn-in-x-bnd-local'], false)).toBe('bn-in-x-bnd-local');
  });
  it('none of them (another phone brand): the phone\'s default, so it never goes silent', () => {
    expect(pickVoice(['bn-in-x-bnc-local', 'en-us-x-iol-local'], true)).toBeUndefined();
    expect(pickVoice([], true)).toBeUndefined();
  });
});
