import { addDays } from '../dates';
import type { Db } from '../db';

/**
 * Decision 19: the ECB reference rate (units of `currency` per euro) published on `date`, or the last one within the
 * 7 days before it (weekends, holidays); null when there is none, so the caller leaves that day out and lists it.
 */
export function rateOn(db: Db, date: string, currency: string): number | null {
  if (currency === 'EUR') return 1;
  const r = db.prepare('SELECT rate FROM fx_rates WHERE currency = ? AND date BETWEEN ? AND ? ORDER BY date DESC LIMIT 1').get(currency, addDays(date, -7), date);
  return r ? Number(r.rate) : null;
}

/** What one unit of `from` is worth in `to` on `date`, at that day's rates; null without a rate. */
export function convertOn(db: Db, date: string, from: string, to: string): number | null {
  if (from === to) return 1;
  const [a, b] = [rateOn(db, date, from), rateOn(db, date, to)];
  return a && b ? b / a : null;
}
