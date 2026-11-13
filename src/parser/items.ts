/**
 * Split a sale into lines (items[]). Pure TS.
 *
 * The scanner hands over "slots" in spoken order: product-name groups,
 * quantities, line totals ("২০০ টাকা"), per-unit prices ("২০০ টাকা করে",
 * "কেজি ৬০") and bare numbers. A line takes at most one of each kind; when a
 * kind repeats, the next line starts. So "২ কেজি চাল ২০০ টাকা ৩ কেজি চাল"
 * is two lines, and the same product twice stays two lines.
 */
import type { Quantity, SaleItem, Unit } from './types';
import { convertUnit } from './units';

export type Slot =
  | { at: number; kind: 'name'; text: string }
  | { at: number; kind: 'qty'; q: Quantity }
  | { at: number; kind: 'total'; v: number }
  | { at: number; kind: 'each'; v: number; unit?: Unit }
  | { at: number; kind: 'bare'; v: number };

interface Line {
  product?: string;
  q?: Quantity;
  total?: number;
  each?: { v: number; unit?: Unit };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const hasPrice = (l: Line) => l.total !== undefined || l.each !== undefined;
const isEmpty = (l: Line) => !l.product && !l.q && !hasPrice(l);

export function groupItems(slots: readonly Slot[]): SaleItem[] {
  const lines: Line[] = [];
  let cur: Line = {};
  const next = () => {
    if (!isEmpty(cur)) lines.push(cur);
    cur = {};
  };

  for (const s of [...slots].sort((a, b) => a.at - b.at)) {
    switch (s.kind) {
      case 'name':
        if (cur.product !== undefined) next();
        cur.product = s.text;
        break;
      case 'qty':
        if (cur.q) next();
        cur.q = s.q;
        break;
      case 'total':
        if (hasPrice(cur)) next();
        cur.total = s.v;
        break;
      case 'each':
        if (hasPrice(cur)) next();
        cur.each = { v: s.v, unit: s.unit };
        break;
      case 'bare':
        // "চাল ২" → quantity; "চাল ২ কেজি ১২০" → line total
        if (!cur.q) cur.q = { value: s.v };
        else if (!hasPrice(cur)) cur.total = s.v;
        else {
          next();
          cur.q = { value: s.v };
        }
        break;
    }
  }
  next();

  // a stray price with no product or quantity ("… মোট ৬০০") is not a line of its own
  const kept = lines.length > 1 ? lines.filter((l) => l.product || l.q) : lines;
  return kept.map(finish);
}

function finish(l: Line): SaleItem {
  const item: SaleItem = {};
  if (l.product) item.product = l.product;
  let q = l.q;

  if (l.each) {
    const priceUnit = l.each.unit ?? q?.unit;
    // "চাল ৩, কেজি ২০০ করে": a unitless quantity takes the price's unit
    if (q && !q.unit && priceUnit) q = { value: q.value, unit: priceUnit };
    item.unitPrice = round2(l.each.v);
    if (priceUnit) item.priceUnit = priceUnit;
    if (q) {
      const inPriceUnit = q.unit && priceUnit ? convertUnit(q.value, q.unit, priceUnit) : q.value;
      if (inPriceUnit !== null) item.total = round2(inPriceUnit * l.each.v);
    }
  } else if (l.total !== undefined) {
    item.total = l.total;
    if (q && q.value > 0) {
      item.unitPrice = round2(l.total / q.value);
      if (q.unit) item.priceUnit = q.unit;
    }
  }
  if (q) item.quantity = q;
  return item;
}
