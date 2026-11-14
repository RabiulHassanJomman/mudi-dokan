/**
 * List import (a .txt file, one item per line) → preview rows. Generic over what is
 * imported: customers now (customerImport.ts), products later (name, unit, prices).
 * Pure TS. Nothing is saved here; the preview screen saves only after হ্যাঁ.
 */
import { toBnDigits } from '../lib/bn';
import { isSame, matchName, type Candidate, type NameMatch } from './names';

export type { Candidate, NameMatch } from './names';

/** no_name makes a row unusable; the others are warnings. */
export type Problem = 'no_name' | 'bad_phone';

export interface ImportSpec<T> {
  parseLine(raw: string): { value: T; problems: Problem[] };
  nameOf(v: T): string;
  /** For the duplicate check (customers). */
  phoneOf?(v: T): string | null;
}

/** নতুন / আগে থেকে আছে / সম্ভবত একই / বাদ (no name). */
export type RowStatus = 'new' | 'exists' | 'maybe' | 'invalid';

export interface ImportRow<T> {
  /** 1-based line in the file; the row's id. */
  line: number;
  raw: string;
  value: T;
  problems: Problem[];
  status: RowStatus;
  match: NameMatch | null;
  include: boolean;
  /** The user toggled include: a re-check keeps their choice. */
  chosen: boolean;
}

export const lineLabel = (line: number) => `লাইন ${toBnDigits(String(line))}`;

/** UTF-8 text → one row per non-blank line (BOM and \r dropped). Not yet checked. */
export function parseImportText<T>(text: string, spec: ImportSpec<T>): ImportRow<T>[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n|\r/)
    .flatMap((raw, i) => {
      const line = raw.trim();
      if (!line) return [];
      const { value, problems } = spec.parseLine(line);
      return [{ line: i + 1, raw: line, value, problems, status: 'new' as RowStatus, match: null, include: false, chosen: false }];
    });
}

/**
 * Status of every row against the shop's list and the lines above it, in file order.
 * Default include: only "নতুন" (a "সম্ভবত একই" row is added only if the user says so).
 */
export function classifyRows<T>(rows: readonly ImportRow<T>[], existing: readonly Candidate[], spec: ImportSpec<T>): ImportRow<T>[] {
  const earlier: Candidate[] = [];
  return rows.map((r) => {
    const name = spec.nameOf(r.value).trim();
    const phone = spec.phoneOf?.(r.value) ?? null;
    let status: RowStatus;
    let match: NameMatch | null = null;
    if (!name || r.problems.includes('no_name')) status = 'invalid';
    else {
      match = matchName(name, phone, [...existing, ...earlier]);
      status = !match ? 'new' : isSame(match.how) ? 'exists' : 'maybe';
      earlier.push({ name, aliases: [], phone, label: lineLabel(r.line) });
    }
    const include = status === 'invalid' ? false : r.chosen ? r.include : status === 'new';
    return { ...r, status, match, include };
  });
}

export function toggleRow<T>(rows: readonly ImportRow<T>[], line: number, _spec?: ImportSpec<T>): ImportRow<T>[] {
  return rows.map((r) => (r.line === line && r.status !== 'invalid' ? { ...r, include: !r.include, chosen: true } : r));
}

/** The user fixed a row (name, phone…): parse problems are re-checked, then every row is re-classified. */
export function editRow<T>(
  rows: readonly ImportRow<T>[],
  line: number,
  value: T,
  existing: readonly Candidate[],
  spec: ImportSpec<T>,
): ImportRow<T>[] {
  const next = rows.map((r) => {
    if (r.line !== line) return r;
    const problems: Problem[] = spec.nameOf(value).trim() ? [] : ['no_name'];
    // a re-check decides include again unless the user had chosen
    return { ...r, value, problems, chosen: r.status === 'invalid' ? false : r.chosen };
  });
  return classifyRows(next, existing, spec);
}

export const includedRows = <T>(rows: readonly ImportRow<T>[]) => rows.filter((r) => r.include);

export interface ImportCounts {
  new: number;
  exists: number;
  maybe: number;
  invalid: number;
  included: number;
}
export function importCounts<T>(rows: readonly ImportRow<T>[]): ImportCounts {
  const n = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return { new: n('new'), exists: n('exists'), maybe: n('maybe'), invalid: n('invalid'), included: includedRows(rows).length };
}
