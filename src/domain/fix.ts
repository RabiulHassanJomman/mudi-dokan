/**
 * ✏️ ঠিক করুন: a saved entry → the same draft the confirm card edits, so a fix uses the
 * same card. Saving it writes correction rows (repo.saveBasketFix / saveEntryFix); the
 * original is never changed. Pure TS. Money in poisha.
 */
import type { Unit } from '../parser/types';
import { canSave, type BasketDraft, type ItemDraft, type ProductInfo } from './basket';
import { customerStatus } from './customers';
import { canSaveEntry, type EntryDraft, type EntryKind } from './entry';

/** One effective line of a saved basket (latest version, not voided). */
export interface StoredSaleLine {
  id: string;
  line_no: number | null;
  product: ProductInfo;
  /** In the product's unit. */
  quantity: number;
  sell_price_poisha: number;
  amount_poisha: number;
  cost_price_poisha: number;
  cost_known: number;
  credit: number;
  customer: string | null;
}

/** Keys are the stored line ids, so the repo can tell which line changed or was removed. */
export function basketFromStored(lines: readonly StoredSaleLine[], knownCustomers: readonly string[]): BasketDraft {
  const items: ItemDraft[] = [...lines]
    .sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))
    .map((l) => ({
      key: l.id,
      productName: l.product.name,
      product: { ...l.product, costPricePoisha: l.cost_known ? l.cost_price_poisha : l.product.costPricePoisha },
      quantity: l.quantity,
      unit: l.product.unit,
      pricePoisha: l.sell_price_poisha,
      amountPoisha: l.amount_poisha,
      priceMode: 'total' as const,
      storedPricePoisha: l.product.sellPricePoisha,
      priceWarning: false,
      unitWarning: false,
      parsed: { product: l.product.name, quantity: { value: l.quantity, unit: l.product.unit }, total: l.amount_poisha / 100, priceKind: 'total' as const },
      alias: null,
      problems: [],
    }));
  const customerName = lines.find((l) => l.customer)?.customer ?? null;
  const credit = lines.some((l) => l.credit);
  const totalPoisha = items.reduce((s, i) => s + (i.amountPoisha ?? 0), 0);
  const customerOk = customerStatus(customerName, knownCustomers) !== 'unknown';
  return {
    items,
    credit,
    customerName,
    customerOk,
    totalPoisha: items.length ? totalPoisha : null,
    problems: items.length ? [] : ['no_items'],
  };
}

/** A saved বাকি / জমা / খরচ / মালিক নিল / মাল কেনা (latest version). */
export interface StoredEntry {
  table: 'ledger' | 'expenses' | 'owner_withdrawals' | 'purchases';
  id: string;
  /** ledger: 'baki' | 'joma'. */
  kind: string | null;
  customer: string | null;
  amount_poisha: number;
  item: string | null;
  person: string | null;
  note: string | null;
  product: ProductInfo | null;
  quantity: number | null;
  spoken_unit: Unit | null;
  buy_price_poisha: number | null;
  sell_price_poisha: number | null;
}

const KIND_OF_TABLE: Record<Exclude<StoredEntry['table'], 'ledger'>, EntryKind> = {
  expenses: 'expense',
  owner_withdrawals: 'owner_withdrawal',
  purchases: 'purchase',
};

export function entryFromStored(s: StoredEntry): EntryDraft {
  const kind: EntryKind = s.table === 'ledger' ? (s.kind === 'joma' ? 'joma' : 'baki') : KIND_OF_TABLE[s.table];
  const d: EntryDraft = {
    kind,
    customerName: s.customer,
    customerOk: !!s.customer,
    amountPoisha: s.amount_poisha,
    item: s.item,
    person: s.person,
    note: s.note,
    purchase:
      kind === 'purchase' && s.product
        ? {
            productName: s.product.name,
            product: s.product,
            quantity: s.quantity,
            unit: s.spoken_unit ?? s.product.unit,
            buyPricePoisha: s.buy_price_poisha,
            sellPricePoisha: s.sell_price_poisha,
            unitWarning: s.spoken_unit !== null && s.spoken_unit !== s.product.unit,
            alias: null,
          }
        : null,
    problems: [],
  };
  return d;
}

/** A fix can be saved when the card is complete (same rules as a new entry). */
export const canSaveFix = (d: BasketDraft | EntryDraft): boolean => ('items' in d ? canSave(d) : canSaveEntry(d));
