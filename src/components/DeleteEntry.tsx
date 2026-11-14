import { useCallback, useState, type ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { archiveParty, customerDeleteCheck, productDeleteCheck, voidEntry } from '../db/repo';
import { writer } from '../device';
import { blockedText, customerPlan, partyDeleteText, productPlan } from '../domain/delete';
import type { EntryTable } from '../domain/history';
import { speak } from '../lib/speak';
import { ConfirmSheet } from './ConfirmSheet';

/**
 * 🗑 মুছুন for one entry (a sale basket or any other): a confirm card that reads the entry
 * aloud, হ্যাঁ/না by voice or button. হ্যাঁ = a voided correction (never a real delete).
 * `sheet` goes anywhere in the screen; `ask` opens it.
 */
export function useDeleteEntry(onDone: () => void): { ask: (t: { table: EntryTable; id: string; text: string }) => void; sheet: ReactNode } {
  const db = useSQLiteContext();
  const [target, setTarget] = useState<{ table: EntryTable; id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const yes = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await voidEntry(db, writer(), target.table, target.id);
      setTarget(null);
      void speak('মুছে ফেলা হয়েছে।');
      onDone();
    } catch (e) {
      void speak('মোছা গেল না।');
      console.warn('voidEntry failed', e);
    } finally {
      setBusy(false);
    }
  };

  return {
    ask: setTarget,
    sheet: <ConfirmSheet visible={!!target} busy={busy} text={target?.text ?? ''} onYes={() => void yes()} onNo={() => setTarget(null)} />,
  };
}

/**
 * Delete a customer or a product: gone if no entries remain; otherwise offered "hide"
 * (the entries stay); a customer who owes can't be hidden. The same confirm card.
 */
export function usePartyDelete(kind: 'customer' | 'product', onDone: () => void): { ask: (id: string, name: string) => Promise<void>; sheet: ReactNode } {
  const db = useSQLiteContext();
  const [target, setTarget] = useState<{ id: string; name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(
    async (id: string, name: string) => {
      const check = kind === 'customer' ? await customerDeleteCheck(db, id) : await productDeleteCheck(db, id);
      const plan = kind === 'customer' ? customerPlan(check) : productPlan(check);
      const text = plan === 'blocked' ? blockedText(name, check.balancePoisha) : partyDeleteText(kind, name, plan)!;
      if (plan === 'blocked') {
        void speak(text);
        return;
      }
      setTarget({ id, name, text });
    },
    [db, kind],
  );

  const yes = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await archiveParty(db, writer(), kind === 'customer' ? 'customers' : 'products', target.id);
      setTarget(null);
      void speak(`${target.name} মুছে ফেলা হয়েছে।`);
      onDone();
    } catch (e) {
      void speak('মোছা গেল না।');
      console.warn('archiveParty failed', e);
    } finally {
      setBusy(false);
    }
  };

  return {
    ask,
    sheet: <ConfirmSheet visible={!!target} busy={busy} text={target?.text ?? ''} onYes={() => void yes()} onNo={() => setTarget(null)} />,
  };
}
