export type Intent =
  | 'sale'
  | 'purchase'
  | 'baki'
  | 'joma'
  | 'expense'
  | 'owner_withdrawal'
  | 'stock_query'
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

export type Field =
  | 'intent'
  | 'product'
  | 'item'
  | 'customer'
  | 'quantity'
  | 'amount'
  | 'buyPrice'
  | 'sellPrice';

export interface ParsedCommand {
  intent: Intent;
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
  /** Extra names that mean the owner/family (e.g. device names); মালিক/আব্বু/আম্মু are built in. */
  ownerNames?: string[];
  /** This phone's role (Setup step ২). Decides what "৩০০ টাকা নিলাম" means; unset = staff. */
  deviceRole?: 'owner' | 'staff';
  /** This phone's device_name ("আব্বু", "কর্মচারী ১"); becomes `person` for first-person commands. */
  deviceName?: string;
}
