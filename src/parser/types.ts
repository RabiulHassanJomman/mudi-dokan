export type Intent =
  | 'sale'
  | 'purchase'
  | 'baki'
  | 'joma'
  | 'expense'
  | 'owner_withdrawal'
  | 'stock_query'
  /** "করিমের বাকি কত?" — what a customer owes. */
  | 'balance_query'
  /** "মোট কত বাকি?", "সবার বাকি কত" — what all customers owe together. */
  | 'total_baki_query'
  | 'profit_query'
  | 'unknown';

export type Unit =
  | 'kg'
  | 'g'
  | 'litre'
  | 'ml'
  | 'piece'
  | 'packet'
  | 'dozen'
  | 'hali'
  | 'bosta';

export interface Quantity {
  value: number;
  unit?: Unit;
}

/** One line of a sale basket. Money in taka (the app converts to poisha). */
export interface SaleItem {
  product?: string;
  quantity?: Quantity;
  /** Price per `priceUnit` ("২০০ টাকা করে", "কেজি ৬০"), or total ÷ quantity. */
  unitPrice?: number;
  /** Unit the unitPrice is for; can differ from quantity.unit ("৫০০ গ্রাম, কেজি ৬০"). */
  priceUnit?: Unit;
  /** Line total: spoken ("২০০ টাকা"), or quantity × unitPrice. */
  total?: number;
  /** Which price was spoken: the line total ("২০০ টাকা") or a per-unit price ("২০০ টাকা করে"). */
  priceKind?: 'total' | 'unit';
}

export type Field =
  | 'intent'
  | 'product'
  | 'item'
  | 'customer'
  | 'quantity'
  | 'amount'
  | 'buyPrice'
  | 'sellPrice';

/** Why the rule parser is unsure (confidence "low" → the router may ask the LLM). */
export type LowReason =
  | 'unconsumed_word' // a word no rule used (brand before a known product, a product in a ledger entry)
  | 'unused_number' // a number or quantity the intent dropped
  | 'unmatched_product' // a product name not in knownProducts / productAliases
  | 'item_count' // basket lines uncertain (stray price dropped, a line with no quantity or price)
  | 'unknown_intent';

export interface ParsedCommand {
  intent: Intent;
  /** "low" when a word/number went unused, a product is unknown, or the line count is unsure. */
  confidence: 'high' | 'low';
  lowReasons?: LowReason[];
  /** Words (not fillers) no rule used. */
  unconsumed?: string[];
  /** Product name as spoken, e.g. "চাল". */
  product?: string;
  /** What the money was spent on (expense only), e.g. "বিদ্যুৎ বিল". */
  item?: string;
  /** Customer name as spoken, e.g. "করিম". */
  customer?: string;
  /** Who took cash (owner_withdrawal, or staff advance as expense), e.g. "মালিক", "আব্বু". */
  person?: string;
  /** Free-text reason (owner_withdrawal, staff advance), e.g. "বাসার জন্য". */
  note?: string;
  quantity?: Quantity;
  /**
   * Sale lines, in spoken order. Always set for a sale; customer and credit apply
   * to the whole basket. product/quantity are filled only for a one-item sale;
   * amount is the basket total when every line has one.
   */
  items?: SaleItem[];
  /** Total taka: "১০০ টাকার চিনি", "২০০ টাকা বাকি", "চাল ২ কেজি ১২০ টাকা", "ভাড়া ২০০০". */
  amount?: number;
  /** Per-unit purchase price (purchase only). */
  buyPrice?: number;
  /** Per-unit selling price (purchase only). */
  sellPrice?: number;
  /** Sale taken on credit; the app writes both a sale and a baki entry. */
  credit?: boolean;
  /** "নতুন ..." — add a new product. */
  isNewProduct?: boolean;
  period?: 'today';
  /** Required fields that were not heard; the confirm card asks for them. */
  missing: Field[];
  raw: string;
  normalized: string;
}

export interface ParseContext {
  /** Open tab; used as the intent when the command has no intent keyword. */
  tab?: 'sale' | 'purchase' | 'ledger' | 'stock' | 'expense';
  /** Known names help split "করিম চাল" into customer + product. */
  knownProducts?: string[];
  knownCustomers?: string[];
  /** Spoken name → product (product_aliases): {"চাউল": "চাল", "লাক্স সাবান": "সাবান"}. */
  productAliases?: Readonly<Record<string, string>>;
  /** Names that mean the owner: device_name of every phone with role মালিক. Only "মালিক" is built in. */
  ownerNames?: string[];
  /** This phone's role (Setup step ২). Decides what "৩০০ টাকা নিলাম" means; unset = staff. */
  deviceRole?: 'owner' | 'staff';
  /** This phone's device_name ("আব্বু", "কর্মচারী ১"); becomes `person` for first-person commands. */
  deviceName?: string;
}
