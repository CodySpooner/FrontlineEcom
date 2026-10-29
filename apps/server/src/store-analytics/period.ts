import { SA_COMPARES, SA_PRESETS, comparePeriod, resolvePeriod, type SaCompare, type SaComparePeriod, type SaPeriod, type SaPreset } from '@frontline/shared';
import type { Db } from '../db';
import { dayFraction, localDate } from '../dates';
import { storeZone } from '../stores';

/** A store's reporting zone: its own (a real store), else this computer's (demo days are dated that way, see storeZone). */
export function zoneInfo(db: Db, storeId: string) {
  const zone = storeZone(db, storeId);
  const name = (style: 'shortGeneric' | 'short') =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const generic = name('shortGeneric'); // "ET"; elsewhere often a long name ("Germany Time"), so the offset instead
  return { zone, label: zone ?? "This computer's time (demo data)", abbr: generic.length <= 4 ? generic : name('short') };
}

/** The first day the store has data for: its first order's day or its first daily total. */
export function historyStart(db: Db, storeId: string): string | undefined {
  const r = db
    .prepare('SELECT min(d) AS d FROM (SELECT min(local_date) AS d FROM orders WHERE store_id = ?1 UNION ALL SELECT min(date) FROM daily_metrics WHERE store_id = ?1)')
    .get(storeId);
  return r?.d == null ? undefined : String(r.d);
}

/** The instant on `date` at the same local clock time as `now`, in `zone` (undefined: this computer's). */
export function sameClock(date: string, now: number, zone?: string) {
  const hms = new Date(now).toLocaleString('sv-SE', { timeZone: zone }).slice(11);
  if (!zone) return new Date(`${date}T${hms}`).getTime();
  const utc = Date.parse(`${date}T${hms}Z`);
  const offset = (t: number) => Date.parse(`${new Date(t).toLocaleString('sv-SE', { timeZone: zone }).replace(' ', 'T')}Z`) - t;
  return utc - offset(utc - offset(utc));
}

export interface StorePeriod {
  period: SaPeriod;
  compareMode: SaCompare;
  compare?: SaComparePeriod;
  today: string;
  zone?: string;
  zoneLabel: string;
  zoneAbbr: string;
  historyStart?: string;
  /** With today in the period: the share of today gone by, and the instant the comparison's last day is cut at. */
  fraction?: number;
  cut?: string;
}

/** Reads `period` (a preset; `from`/`to` with custom) and `compare` for one store; an error message for bad input. */
export function storePeriod(db: Db, storeId: string, q: (k: string) => string | undefined, now = Date.now()): StorePeriod | string {
  const preset = (q('period') ?? 'last30') as SaPreset;
  const compareMode = (q('compare') ?? 'previous') as SaCompare;
  if (!SA_PRESETS.some((p) => p.id === preset)) return `period must be one of ${SA_PRESETS.map((p) => p.id).join(', ')}`;
  if (!SA_COMPARES.some((c) => c.id === compareMode)) return 'compare must be previous, year or none';
  const { zone, label, abbr } = zoneInfo(db, storeId);
  const today = localDate(new Date(now), zone);
  const period = resolvePeriod(preset, today, { from: q('from') ?? '', to: q('to') ?? '' });
  if (typeof period === 'string') return period;
  const start = historyStart(db, storeId);
  const compare = comparePeriod(period, compareMode, start);
  const out: StorePeriod = { period, compareMode, today, zone, zoneLabel: label, zoneAbbr: abbr, ...(start && { historyStart: start }), ...(compare && { compare }) };
  if (!period.partial) return out;
  const cutDay = compare && 'to' in compare ? compare.to : undefined;
  return { ...out, fraction: dayFraction(today, now, zone), ...(cutDay && { cut: new Date(sameClock(cutDay, now, zone)).toISOString() }) };
}
