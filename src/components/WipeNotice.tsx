import { useState } from 'react';

import { nav } from '../lib/nav';
import { speak } from '../lib/speak';
import { startSync, useSyncStatus } from '../sync/app';
import { CLOUD_WIPED_BN, CLOUD_WIPED_KEEP_BN } from '../sync/words';
import { ConfirmSheet } from './ConfirmSheet';

/**
 * Another phone erased the whole shop: ask before this phone does anything (it sends nothing
 * and fetches nothing while paused). হ্যাঁ = erase this phone too and start over;
 * না = keep the data, stay paused (the সিঙ্ক screen can send it again on purpose).
 */
export function WipeNotice() {
  const status = useSyncStatus();
  const pending = status?.wipePending ?? null;
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const show = pending !== null && status?.phase === 'wiped' && dismissed !== pending;

  const yes = async () => {
    setBusy(true);
    try {
      const c = await startSync();
      await c.acceptWipe();
      void speak('এই ফোনের সব তথ্যও মুছে ফেলা হয়েছে।');
      nav.replace('/setup');
    } catch (e) {
      console.warn('acceptWipe failed', e);
      void speak('মোছা গেল না।');
    } finally {
      setBusy(false);
    }
  };

  const no = () => {
    setDismissed(pending);
    void startSync().then((c) => c.keepAfterWipe());
    void speak(CLOUD_WIPED_KEEP_BN);
  };

  return <ConfirmSheet visible={show} busy={busy} text={CLOUD_WIPED_BN} onYes={() => void yes()} onNo={no} />;
}
