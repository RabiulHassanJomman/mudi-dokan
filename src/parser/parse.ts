import * as K from './keywords';
import { tokenize } from './normalize';
import { parseNumber } from './numbers';
import type { Field, Intent, ParseContext, ParsedCommand, Quantity } from './types';
import { parseUnit } from './units';
import { nfc } from './util';

/** Expense item for cash a staff member takes for themselves. */
const STAFF_ADVANCE = nfc('অগ্রিম বেতন');
const GENITIVE = nfc('ের');
const OBJECTIVE = nfc('কে');

/** "তেলের" → "তেল", "করিমের" → "করিম". */
const stripGenitive = (t: string): string =>
  t.length > GENITIVE.length + 1 && t.endsWith(GENITIVE) ? t.slice(0, -GENITIVE.length) : t;

/** "করিমকে" → "করিম" (customer names only). */
const stripObjective = (t: string): string =>
  t.length > OBJECTIVE.length + 1 && t.endsWith(OBJECTIVE) ? t.slice(0, -OBJECTIVE.length) : t;

const isNoise = (t: string): boolean =>
  K.ALL_KEYWORDS.has(t) || parseUnit(t) !== null || /^\d/.test(t);

const joinOrUndef = (ts: readonly string[]): string | undefined =>
  ts.length ? ts.join(' ') : undefined;

const customerName = (ts: readonly string[]): string | undefined => {
  if (!ts.length) return undefined;
  const copy = [...ts];
  copy[copy.length - 1] = stripObjective(copy[copy.length - 1]!);
  return copy.join(' ');
};

interface KnownHit {
  match: string;
  rest: string[];
}

/** Find the longest known name appearing as contiguous tokens in `names`. */
function matchKnown(names: readonly string[], known: readonly string[] | undefined): KnownHit | null {
  if (!known?.length) return null;
  const candidates = known
    .map((k) => tokenize(k).map(stripGenitive))
    .filter((k) => k.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const k of candidates) {
    for (let s = 0; s + k.length <= names.length; s++) {
      if (k.every((t, o) => names[s + o] === t)) {
        return { match: k.join(' '), rest: [...names.slice(0, s), ...names.slice(s + k.length)] };
      }
    }
  }
  return null;
}

type PriceKind = 'buy' | 'sell' | 'price';

/** Look behind tokens[i] for "কেনা", "বেচা", "দাম", "কেনা দাম" etc. Marks them used. */
function priceMarkerBefore(tokens: readonly string[], used: boolean[], i: number): PriceKind | null {
  let p = i - 1;
  let kind: PriceKind | null = null;
  const at = (k: number) => (k >= 0 && !used[k] ? tokens[k] : undefined);
  const marks: number[] = [];
  const t0 = at(p);
  if (t0 !== undefined && K.DAM.has(t0)) {
    kind = 'price';
    marks.push(p);
    p--;
  }
  const t1 = at(p);
  if (t1 !== undefined && K.BUY_MARKER.has(t1)) {
    kind = 'buy';
    marks.push(p);
  } else if (t1 !== undefined && K.SELL_MARKER.has(t1)) {
    kind = 'sell';
    marks.push(p);
  }
  for (const m of marks) used[m] = true;
  return kind;
}

/** Drop undefined fields so results are easy to read and compare. */
function compact(cmd: ParsedCommand): ParsedCommand {
  const out = { ...cmd } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as ParsedCommand;
}

export function parseCommand(text: string, ctx: ParseContext = {}): ParsedCommand {
  const tokens = tokenize(text);
  const base = { raw: text, normalized: tokens.join(' ') };
  if (!tokens.length) return { intent: 'unknown', missing: [], ...base };

  const has = (s: ReadonlySet<string>) => tokens.some((t) => s.has(t));
  const period = has(K.TODAY) ? ('today' as const) : undefined;

  // ── queries ────────────────────────────────────────────────
  if (has(K.PROFIT)) {
    return compact({ intent: 'profit_query', period, missing: [], ...base });
  }
  if (has(K.STOCK) && !has(K.BAKI) && !has(K.CREDIT) && !has(K.JOMA)) {
    const product = joinOrUndef(tokens.filter((t) => !isNoise(t)).map(stripGenitive));
    return compact({ intent: 'stock_query', product, period, missing: product ? [] : ['product'], ...base });
  }

  // ── numbers and their roles ────────────────────────────────
  const used = tokens.map(() => false);
  let quantity: Quantity | undefined;
  let amount: number | undefined;
  let buyPrice: number | undefined;
  let sellPrice: number | undefined;
  const prices: number[] = [];
  const bare: number[] = [];
  let anyNumber = false;

  let i = 0;
  while (i < tokens.length) {
    const num = used[i] ? null : parseNumber(tokens, i);
    if (!num) {
      i++;
      continue;
    }
    anyNumber = true;
    const end = i + num.consumed;
    for (let k = i; k < end; k++) used[k] = true;
    const next = tokens[end];
    const nextIsMoney = next !== undefined && K.MONEY.has(next);

    const unit = next !== undefined ? parseUnit(next) : null;
    if (unit) {
      used[end] = true;
      quantity ??= { value: Math.round(num.value * unit.factor * 1e6) / 1e6, unit: unit.unit };
      i = end + 1;
      continue;
    }

    const marker = priceMarkerBefore(tokens, used, i);
    if (marker) {
      if (nextIsMoney) used[end] = true;
      if (marker === 'buy') buyPrice ??= num.value;
      else if (marker === 'sell') sellPrice ??= num.value;
      else prices.push(num.value);
      i = nextIsMoney ? end + 1 : end;
      continue;
    }

    if (nextIsMoney) {
      used[end] = true;
      amount ??= num.value;
      i = end + 1;
      continue;
    }

    const prev = tokens[i - 1];
    if (prev !== undefined && !used[i - 1] && K.MONEY.has(prev)) {
      used[i - 1] = true; // "৳১০০" → "টাকা 100"
      amount ??= num.value;
      i = end;
      continue;
    }

    if (num.classifier) quantity ??= { value: num.value, unit: 'piece' };
    else bare.push(num.value);
    i = end;
  }

  // ── names ──────────────────────────────────────────────────
  const rawNames = tokens.filter((t, k) => !used[k] && !isNoise(t));
  const names = rawNames.map(stripGenitive);
  const prodHit = matchKnown(names, ctx.knownProducts);
  const afterProd = prodHit ? prodHit.rest : names;
  const custHit = matchKnown(afterProd, ctx.knownCustomers);
  const remaining = custHit ? custHit.rest : afterProd;

  // ── intent ─────────────────────────────────────────────────
  const creditWords = has(K.CREDIT) || (has(K.BAKI) && has(K.TAKE));
  const expenseHint = tokens.some(
    (t) => K.EXPENSE_HINT.has(t) || K.EXPENSE_HINT_SUFFIXES.some((s) => t.length > s.length && t.endsWith(s)),
  );
  const hasMoney = amount !== undefined || bare.length > 0 || prices.length > 0;

  // owner/family withdrawal: an owner name (or "নিলাম") + money, and no stronger keyword
  let ownerIdx = names.findIndex((t) => K.OWNER.has(t));
  let ownerName = ownerIdx >= 0 ? names[ownerIdx] : undefined;
  if (ownerName === undefined) {
    const hit = matchKnown(names, ctx.ownerNames);
    if (hit) {
      ownerName = hit.match;
      const first = hit.match.split(' ')[0]!;
      ownerIdx = names.indexOf(first);
    }
  }
  const strongerKeyword = [K.EXPENSE, K.BAKI, K.CREDIT, K.JOMA, K.SALE, K.PURCHASE, K.NEW].some(has);
  const isWithdrawal =
    !strongerKeyword &&
    quantity === undefined &&
    ((ownerName !== undefined && (hasMoney || has(K.TAKE))) || (has(K.SELF_TAKE) && hasMoney));

  // "৩০০ টাকা নিলাম": who took it depends on whose phone this is
  const firstPerson = isWithdrawal && ownerName === undefined;
  // role not set → staff: an unknown phone's cash-out is counted, not hidden from profit
  const staffAdvance = firstPerson && ctx.deviceRole !== 'owner';

  let intent: Intent;
  let credit = false;
  let ledgerGuess = false;
  if (staffAdvance) intent = 'expense';
  else if (isWithdrawal) intent = 'owner_withdrawal';
  else if (has(K.EXPENSE)) intent = 'expense';
  else if (has(K.PURCHASE) || has(K.NEW)) intent = 'purchase';
  else if (creditWords && (quantity !== undefined || names.length >= 2 || prodHit !== null)) {
    intent = 'sale';
    credit = true;
  } else if (has(K.BAKI) || creditWords) intent = 'baki';
  else if (has(K.JOMA)) intent = 'joma';
  else if (has(K.SALE)) intent = 'sale';
  else if (expenseHint && hasMoney && quantity === undefined) intent = 'expense';
  else if (has(K.GAVE) && amount !== undefined && quantity === undefined) intent = 'joma';
  else if (ctx.tab === 'sale') intent = 'sale';
  else if (ctx.tab === 'purchase') intent = 'purchase';
  else if (ctx.tab === 'stock') intent = 'stock_query';
  else if (ctx.tab === 'expense') intent = 'expense';
  else if (ctx.tab === 'ledger') {
    intent = 'unknown'; // baki or joma? the confirm card asks
    ledgerGuess = true;
  } else intent = anyNumber ? 'sale' : 'unknown';

  const isLedger = intent === 'baki' || intent === 'joma' || ledgerGuess;
  const isTrade = intent === 'sale' || intent === 'purchase';
  const isExpense = intent === 'expense';
  const isOwner = intent === 'owner_withdrawal';

  // ── resolve leftover numbers by intent ─────────────────────
  if (intent === 'sale') {
    if (sellPrice !== undefined) amount ??= sellPrice; // "২ কেজি বিক্রি ১২০"
    sellPrice = undefined;
    buyPrice = undefined;
  }
  for (const p of prices) {
    if (intent === 'purchase') buyPrice ??= p;
    else amount ??= p;
  }
  for (const b of bare) {
    if (isTrade && quantity === undefined && amount === undefined) quantity = { value: b };
    else amount ??= b;
  }
  if (isLedger || isExpense || isOwner) quantity = undefined;

  // ── assign names ───────────────────────────────────────────
  let product: string | undefined;
  let item: string | undefined;
  let customer: string | undefined;
  let person: string | undefined;
  let note: string | undefined;
  if (isOwner || staffAdvance) {
    person = firstPerson ? ctx.deviceName : ownerName;
    const width = ownerName ? ownerName.split(' ').length : 0;
    // keep the note as spoken ("ওষুধের জন্য"), no genitive stripping
    note = joinOrUndef(rawNames.filter((_, k) => ownerIdx < 0 || k < ownerIdx || k >= ownerIdx + width));
    if (staffAdvance) item = STAFF_ADVANCE;
  } else if (isExpense) {
    item = joinOrUndef(names);
  } else if (isLedger) {
    customer = matchKnown(names, ctx.knownCustomers)?.match ?? customerName(names);
  } else if (intent === 'stock_query') {
    product = joinOrUndef(names);
  } else if (isTrade) {
    product = prodHit?.match;
    customer = custHit?.match;
    if (credit && !product && !customer) {
      customer = customerName(remaining.slice(0, 1));
      product = joinOrUndef(remaining.slice(1));
    } else if (credit && !customer) {
      customer = customerName(remaining);
    } else if (!product) {
      product = joinOrUndef(remaining);
    }
  }

  // ── missing fields ─────────────────────────────────────────
  const missing: Field[] = [];
  if (ledgerGuess) missing.push('intent');
  if (isTrade) {
    if (!product) missing.push('product');
    if (intent === 'sale' && credit && !customer) missing.push('customer');
    if (intent === 'sale' && !quantity && amount === undefined) missing.push('quantity');
    if (intent === 'purchase' && !quantity) missing.push('quantity');
  }
  if (isLedger) {
    if (!customer) missing.push('customer');
    if (amount === undefined) missing.push('amount');
  }
  if (intent === 'stock_query' && !product) missing.push('product');
  if (isOwner && amount === undefined) missing.push('amount');
  if (isExpense) {
    if (!item) missing.push('item');
    if (amount === undefined) missing.push('amount');
  }

  const isNewProduct = intent === 'purchase' && has(K.NEW) ? true : undefined;
  if (isNewProduct) {
    if (buyPrice === undefined) missing.push('buyPrice');
    if (sellPrice === undefined) missing.push('sellPrice');
  }

  if (intent === 'unknown' && !ledgerGuess) {
    return { intent, missing: [], ...base };
  }

  return compact({
    intent,
    product,
    item,
    customer,
    person,
    note,
    quantity,
    amount,
    buyPrice: intent === 'purchase' ? buyPrice : undefined,
    sellPrice: intent === 'purchase' ? sellPrice : undefined,
    credit: credit || undefined,
    isNewProduct,
    period,
    missing,
    ...base,
  });
}
