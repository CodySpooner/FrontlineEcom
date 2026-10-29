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

/**
 * Converts order money into the store's currency at the order's locked rate or its day's rate. What had no rate is
 * counted (`n` orders, or 0 for refunds) for the note; the caller leaves it out (decision 19).
 */
export function storeConverter(db: Db, storeCur: string) {
  const unconverted = new Map<string, number>();
  const fx = (day: string, cur: unknown, locked: unknown, n: number) => {
    const x = locked != null ? Number(locked) : convertOn(db, day, cur == null ? storeCur : String(cur), storeCur);
    if (x == null) unconverted.set(`${String(cur)} on ${day}`, (unconverted.get(`${String(cur)} on ${day}`) ?? 0) + n);
    return x;
  };
  const note = () =>
    unconverted.size ? `Left out, no exchange rate: ${[...unconverted].map(([k, n]) => (n ? `${n} order${n === 1 ? '' : 's'} in ${k}` : `refunds in ${k}`)).join('; ')}` : undefined;
  return { fx, unconverted, note };
}
