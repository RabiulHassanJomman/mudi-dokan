import { groupItemsReport, type Slot } from './items';
import * as K from './keywords';
import { tokenize } from './normalize';
import { parseNumber } from './numbers';
import type { Field, Intent, LowReason, ParseContext, ParsedCommand, Quantity, SaleItem } from './types';
import { parseUnit, type UnitMatch } from './units';
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

/** Positions in `names` covered by any known name (longest first, no overlaps). */
function knownPositions(names: readonly string[], known: readonly string[] | undefined): Set<number> {
  const covered = new Set<number>();
  if (!known?.length) return covered;
  const candidates = known
    .map((k) => tokenize(k).map(stripGenitive))
    .filter((k) => k.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const k of candidates) {
    for (let s = 0; s + k.length <= names.length; s++) {
      const span = k.map((_, o) => s + o);
      if (span.some((p) => covered.has(p))) continue;
      if (k.every((t, o) => names[s + o] === t)) span.forEach((p) => covered.add(p));
    }
  }
  return covered;
}

/** First known name (longest first) in `names`, skipping `exclude`d positions: [start, length]. */
function knownSpan(
  names: readonly string[],
  known: readonly string[] | undefined,
  exclude: ReadonlySet<number>,
): [number, number] | null {
  if (!known?.length) return null;
  const candidates = known
    .map((k) => tokenize(k).map(stripGenitive))
    .filter((k) => k.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const k of candidates) {
    for (let s = 0; s + k.length <= names.length; s++) {
      if (k.some((_, o) => exclude.has(s + o))) continue;
      if (k.every((t, o) => names[s + o] === t)) return [s, k.length];
    }
  }
  return null;
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

/**
 * Per-unit price around the number at tokens[i..end):
 *   "২০০ টাকা করে", "২০০ করে", "২০০ টাকা প্রতি কেজি", "২০০ টাকা কেজি",
 *   "কেজি ২০০", "প্রতি কেজি ২০০", "কেজি প্রতি ২০০".
 * Marks the marker words used. Returns the price's unit (if said) and where scanning resumes.
 */
function perUnitPrice(
  tokens: readonly string[],
  used: boolean[],
  i: number,
  end: number,
): { unit?: UnitMatch; next: number } | null {
  const tok = (k: number) => (k >= 0 && k < tokens.length && !used[k] ? tokens[k] : undefined);
  const marks: number[] = [];
  let after = end;
  const money = tok(after);
  const moneyAfter = money !== undefined && K.MONEY.has(money);
  if (moneyAfter) {
    marks.push(after);
    after++;
  }
  let unit: UnitMatch | undefined;
  let hit = false;

  const a = tok(after);
  if (a !== undefined && K.EACH.has(a)) {
    hit = true;
    marks.push(after++);
  } else if (a !== undefined && K.PER.has(a)) {
    hit = true;
    marks.push(after++);
    const u = tok(after);
    const um = u !== undefined ? parseUnit(u) : null;
    if (um) {
      unit = um;
      marks.push(after++);
    }
  } else if (moneyAfter && a !== undefined && parseUnit(a)) {
    hit = true;
    unit = parseUnit(a) ?? undefined;
    marks.push(after++);
  }

  const b1 = tok(i - 1);
  const b2 = tok(i - 2);
  if (b1 !== undefined && K.PER.has(b1)) {
    hit = true;
    marks.push(i - 1);
    const um = b2 !== undefined ? parseUnit(b2) : null;
    if (um && !unit) {
      unit = um;
      marks.push(i - 2);
    }
  } else if (b1 !== undefined && parseUnit(b1)) {
    hit = true;
    unit ??= parseUnit(b1) ?? undefined;
    marks.push(i - 1);
    if (b2 !== undefined && K.PER.has(b2)) marks.push(i - 2);
  }

  if (!hit) return null;
  for (const m of marks) used[m] = true;
  return { unit, next: after };
}

/** Drop undefined fields so results are easy to read and compare. */
function compact(cmd: ParsedCommand): ParsedCommand {
  const out = { ...cmd } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as ParsedCommand;
}

/** Token form of a name, as names are compared ("তেলের" → "তেল"). */
const nameKey = (s: string) => tokenize(s).map(stripGenitive).join(' ');

const LOW_UNKNOWN = { confidence: 'low' as const, lowReasons: ['unknown_intent' as LowReason] };

export function parseCommand(text: string, ctx: ParseContext = {}): ParsedCommand {
  const tokens = tokenize(text);
  const base = { raw: text, normalized: tokens.join(' ') };
  if (!tokens.length) return { intent: 'unknown', missing: [], ...LOW_UNKNOWN, ...base };

  // aliases count as known products; canon() maps them to the product's name
  const aliases = new Map(Object.entries(ctx.productAliases ?? {}).map(([k, v]) => [nameKey(k), v.normalize('NFC')]));
  const knownProducts = [...(ctx.knownProducts ?? []), ...aliases.keys()];
  const knownProductKeys = new Set(knownProducts.map(nameKey));
  const canon = (name: string) => aliases.get(name) ?? name;
  const checkProducts = knownProducts.length > 0;

  const has = (s: ReadonlySet<string>) => tokens.some((t) => s.has(t));
  const period = has(K.TODAY) ? ('today' as const) : undefined;

  // ── queries ────────────────────────────────────────────────
  if (has(K.PROFIT)) {
    return compact({ intent: 'profit_query', period, missing: [], confidence: 'high', ...base });
  }
  // "করিমের বাকি কত?", "করিমের কাছে কত পাবো": a question, no amount said.
  // No name left ("মোট কত বাকি", "সবার বাকি কত", "কে কে বাকি আছে", "বাকির লিস্ট") = all customers.
  const anyNumberAt = tokens.some((_, k) => parseNumber(tokens, k) !== null);
  const summaryWord = (t: string) => K.EVERY.has(t) || K.LIST.has(t) || K.SHOW.has(t);
  const bakiAsked = has(K.BAKI) || has(K.OWED) || has(K.BAKI_OF);
  const bakiQuestion = has(K.HOW_MUCH) || has(K.LIST) || has(K.WHO);
  if (bakiAsked && bakiQuestion && !anyNumberAt && !has(K.CREDIT) && !has(K.TAKE)) {
    const names = tokens
      .filter((t) => !isNoise(t) && !summaryWord(t) && !K.WHO.has(t) && !K.BAKI_OF.has(t))
      .map(stripGenitive);
    if (!names.length) return compact({ intent: 'total_baki_query', missing: [], confidence: 'high', ...base });
    const hit = matchKnown(names, ctx.knownCustomers);
    const customer = hit?.match ?? customerName(names);
    return compact({
      intent: 'balance_query',
      customer,
      missing: customer ? [] : ['customer'],
      confidence: 'high',
      ...base,
    });
  }
  // "সব মাল কত আছে", "মালের লিস্ট", "কি কি মাল আছে", "স্টক দেখাও": no product left = every product
  const stockAsked = has(K.GOODS) || has(K.LIST) || tokens.some((t) => t === 'স্টক' || t === 'মজুদ');
  if (stockAsked && !anyNumberAt && !bakiAsked && !has(K.CREDIT) && !has(K.JOMA) && !has(K.PURCHASE) && !has(K.SALE)) {
    const rest = tokens.filter((t) => !isNoise(t) && !summaryWord(t) && !K.GOODS.has(t));
    if (!rest.length) return compact({ intent: 'all_stock_query', missing: [], confidence: 'high', ...base });
  }
  if (has(K.STOCK) && !has(K.BAKI) && !has(K.CREDIT) && !has(K.JOMA)) {
    const spoken = joinOrUndef(tokens.filter((t) => !isNoise(t) && !K.SHOW.has(t)).map(stripGenitive));
    const product = spoken === undefined ? undefined : canon(spoken);
    const unmatched = checkProducts && product !== undefined && !knownProductKeys.has(spoken!);
    return compact({
      intent: 'stock_query',
      product,
      period,
      missing: product ? [] : ['product'],
      confidence: unmatched ? 'low' : 'high',
      lowReasons: unmatched ? ['unmatched_product'] : undefined,
      ...base,
    });
  }

  // ── numbers and their roles ────────────────────────────────
  const used = tokens.map(() => false);
  let quantity: Quantity | undefined;
  let amount: number | undefined;
  let buyPrice: number | undefined;
  let sellPrice: number | undefined;
  const prices: number[] = [];
  const bare: number[] = [];
  const unitPrices: number[] = [];
  /** Every number's role and position, for splitting a sale into lines. */
  const events: Slot[] = [];
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
      const q: Quantity = { value: Math.round(num.value * unit.factor * 1e6) / 1e6, unit: unit.unit };
      quantity ??= q;
      events.push({ at: i, kind: 'qty', q });
      i = end + 1;
      continue;
    }

    const per = perUnitPrice(tokens, used, i, end);
    if (per) {
      // "পোয়া ২০" = ৳২০ per quarter kg = ৳৮০ per kg
      const v = per.unit ? Math.round((num.value / per.unit.factor) * 100) / 100 : num.value;
      unitPrices.push(v);
      events.push({ at: i, kind: 'each', v, unit: per.unit?.unit });
      i = per.next;
      continue;
    }

    const marker = priceMarkerBefore(tokens, used, i);
    if (marker) {
      if (nextIsMoney) used[end] = true;
      if (marker === 'buy') buyPrice ??= num.value;
      else if (marker === 'sell') sellPrice ??= num.value;
      else prices.push(num.value);
      // for a sale, "বিক্রি ১২০" / "দাম ১২০" is a line total
      if (marker !== 'buy') events.push({ at: i, kind: 'total', v: num.value });
      i = nextIsMoney ? end + 1 : end;
      continue;
    }

    if (nextIsMoney) {
      used[end] = true;
      amount ??= num.value;
      events.push({ at: i, kind: 'total', v: num.value });
      i = end + 1;
      continue;
    }

    const prev = tokens[i - 1];
    if (prev !== undefined && !used[i - 1] && K.MONEY.has(prev)) {
      used[i - 1] = true; // "৳১০০" → "টাকা 100"
      amount ??= num.value;
      events.push({ at: i, kind: 'total', v: num.value });
      i = end;
      continue;
    }

    if (num.classifier) {
      const q: Quantity = { value: num.value, unit: 'piece' };
      quantity ??= q;
      events.push({ at: i, kind: 'qty', q });
    } else {
      bare.push(num.value);
      events.push({ at: i, kind: 'bare', v: num.value });
    }
    i = end;
  }

  // ── names ──────────────────────────────────────────────────
  const namePos = tokens.map((_, k) => k).filter((k) => !used[k] && !isNoise(tokens[k]!));
  const rawNames = namePos.map((k) => tokens[k]!);
  const names = rawNames.map(stripGenitive);
  const prodHit = matchKnown(names, knownProducts);
  const afterProd = prodHit ? prodHit.rest : names;
  const custHit = matchKnown(afterProd, ctx.knownCustomers);
  const remaining = custHit ? custHit.rest : afterProd;

  // ── intent ─────────────────────────────────────────────────
  const creditWords = has(K.CREDIT) || (has(K.BAKI) && has(K.TAKE));
  const expenseHint = tokens.some(
    (t) => K.EXPENSE_HINT.has(t) || K.EXPENSE_HINT_SUFFIXES.some((s) => t.length > s.length && t.endsWith(s)),
  );
  const hasMoney = amount !== undefined || bare.length > 0 || prices.length > 0 || unitPrices.length > 0;

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
  else if (
    (creditWords && (quantity !== undefined || names.length >= 2 || prodHit !== null)) ||
    // "করিম চাল ১০ কেজি বাকি": goods with a quantity on বাকি = credit sale, not a ledger entry
    (has(K.BAKI) && quantity !== undefined)
  ) {
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
  for (const p of unitPrices) {
    if (intent === 'purchase') buyPrice ??= p;
    else if (intent !== 'sale') amount ??= p;
  }
  for (const b of bare) {
    if (isTrade && quantity === undefined && amount === undefined) quantity = { value: b };
    else amount ??= b;
  }
  if (isLedger || isExpense || isOwner) quantity = undefined;

  // ── confidence: what no rule used ──────────────────────────
  const lowReasons = new Set<LowReason>();
  const unconsumed: string[] = [];
  if (isLedger || isExpense || isOwner) {
    // these keep one amount; a quantity or a second number was dropped
    const money = events.filter((e) => e.kind !== 'qty').length;
    if (events.some((e) => e.kind === 'qty') || money > 1) lowReasons.add('unused_number');
  }
  if (intent === 'unknown' || ledgerGuess) lowReasons.add('unknown_intent');

  // ── assign names ───────────────────────────────────────────
  let product: string | undefined;
  let item: string | undefined;
  let customer: string | undefined;
  let items: SaleItem[] | undefined;
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
    const hit = matchKnown(names, ctx.knownCustomers);
    customer = hit?.match ?? customerName(names);
    if (hit) unconsumed.push(...hit.rest);
    // a known product inside a ledger entry ("করিম চাল ২০০ টাকা বাকি") is not part of the name
    else unconsumed.push(...names.filter((n) => knownProductKeys.has(n)));
  } else if (intent === 'stock_query') {
    product = joinOrUndef(names);
    if (product !== undefined) product = canon(product);
  } else if (intent === 'sale') {
    // customer: a known customer; else on credit the first unknown name; else (cash)
    // only a name marked as a person: "রহিম ভাই", "রহিমকে", "… রহিম কে", or "নিল" with a name apart
    const productAt = knownPositions(names, knownProducts);
    const known = knownSpan(names, ctx.knownCustomers, productAt);
    const free = names.map((_, n) => n).filter((n) => !productAt.has(n));
    const adjacent = (a: number, b: number) => b === a + 1 && namePos[b] === namePos[a]! + 1;
    const runs: number[][] = [];
    for (const n of free) {
      const last = runs[runs.length - 1];
      if (last && adjacent(last[last.length - 1]!, n)) last.push(n);
      else runs.push([n]);
    }
    // a name run with no number or unit next to it ("… তেল দিলাম হাসান কে")
    const touchesNumber = (r: number[]) =>
      used[namePos[r[0]!]! - 1] === true || used[namePos[r[r.length - 1]!]! + 1] === true;
    let custAt: number[] = [];
    if (known) custAt = Array.from({ length: known[1] }, (_, o) => known[0] + o);
    else if (credit) {
      const apart = productAt.size ? undefined : runs.find((r) => !touchesNumber(r));
      if (apart) custAt = apart;
      else if (free.length) custAt = [free[0]!];
      // products are known: the customer is the whole first run of other names
      if (productAt.size && !apart) {
        for (let n = 1; n < free.length && adjacent(free[n - 1]!, free[n]!); n++) custAt.push(free[n]!);
      }
    } else {
      const marked = (r: number[]) => {
        const lastRaw = rawNames[r[r.length - 1]!]!;
        const after = tokens[namePos[r[r.length - 1]!]! + 1];
        return (
          (lastRaw.length > OBJECTIVE.length + 1 && lastRaw.endsWith(OBJECTIVE)) ||
          (after !== undefined && (after === OBJECTIVE || K.HONORIFIC_SET.has(after)))
        );
      };
      const pick = runs.find(marked) ?? (has(K.TAKE) ? runs.find((r) => !touchesNumber(r)) : undefined);
      // never the only name: "চাল নিল ২ কেজি" has a product, not a customer
      if (pick && pick.length < names.length) custAt = pick;
    }
    const custNames = custAt.map((n) => names[n]!);
    customer = !custNames.length ? undefined : known ? custNames.join(' ') : customerName(custNames);

    // product names: runs of adjacent leftover tokens, minus the customer
    const slots: Slot[] = [...events];
    let run: number[] = [];
    const flushRun = () => {
      if (!run.length) return;
      const spoken = run.map((n) => names[n]!);
      const text = spoken.join(' ');
      if (checkProducts && !knownProductKeys.has(text)) {
        // "লাক্স সাবান" with no alias: সাবান is known, লাক্স is not used by anything
        const hit = knownSpan(spoken, knownProducts, new Set());
        if (hit) unconsumed.push(...spoken.filter((_, o) => o < hit[0] || o >= hit[0] + hit[1]));
        else lowReasons.add('unmatched_product');
      }
      slots.push({ at: namePos[run[0]!]!, kind: 'name', text: canon(text) });
      run = [];
    };
    names.forEach((_, n) => {
      if (custAt.includes(n)) return flushRun();
      if (run.length && namePos[n] !== namePos[run[run.length - 1]!]! + 1) flushRun();
      run.push(n);
    });
    flushRun();

    const grouped = groupItemsReport(slots);
    items = grouped.items;
    const incomplete = items.some((it) => !it.product || (!it.quantity && it.total === undefined));
    if (grouped.dropped > 0 || (items.length > 1 && incomplete)) lowReasons.add('item_count');
    if (items.length === 1) {
      product = items[0]!.product;
      quantity = items[0]!.quantity;
      amount = items[0]!.total;
    } else {
      product = undefined;
      quantity = undefined;
      amount = items.length && items.every((it) => it.total !== undefined)
        ? Math.round(items.reduce((sum, it) => sum + it.total!, 0) * 100) / 100
        : undefined;
    }
  } else if (isTrade) {
    product = prodHit ? canon(prodHit.match) : undefined;
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
  if (intent === 'sale' && items) {
    if (!items.length || items.some((it) => !it.product)) missing.push('product');
    if (credit && !customer) missing.push('customer');
    if (!items.length || items.some((it) => !it.quantity && it.total === undefined)) missing.push('quantity');
  } else if (isTrade) {
    if (!product) missing.push('product');
    if (!quantity) missing.push('quantity');
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
    return { intent, missing: [], ...LOW_UNKNOWN, ...base };
  }
  if (unconsumed.length) lowReasons.add('unconsumed_word');
  const reasons = [...lowReasons];

  return compact({
    intent,
    product,
    item,
    customer,
    person,
    note,
    quantity,
    amount,
    items,
    buyPrice: intent === 'purchase' ? buyPrice : undefined,
    sellPrice: intent === 'purchase' ? sellPrice : undefined,
    credit: credit || undefined,
    isNewProduct,
    period,
    missing,
    confidence: reasons.length ? 'low' : 'high',
    lowReasons: reasons.length ? reasons : undefined,
    unconsumed: unconsumed.length ? unconsumed : undefined,
    ...base,
  });
}
