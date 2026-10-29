import { addDays } from './dates';
import { tx, type Db } from './db';
import { log } from './log';
import { getSettings } from './settings';
import { convertOn } from './store-analytics/fx';

// ECB euro reference rates (published ~16:00 CET on working days), cached in settings so totals work offline.
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const ECB_HISTORY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

type Fetch = typeof fetch;
interface Rates {
  date: string;
  fetchedAt?: string;
  /** Units of each currency per 1 EUR. */
  rates: Record<string, number>;
  /** SA-53: the ECB's history is in fx_rates. */
  history?: boolean;
}

export function parseEcb(xml: string): Rates {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rates: Record<string, number> = { EUR: 1 };
  for (const [, cur, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[cur!] = Number(rate);
  if (!date || Object.keys(rates).length < 2) throw new Error('ECB rates: unexpected response');
  return { date, rates };
}

const cached = (db: Db): Rates | undefined => {
  const r = db.prepare("SELECT value_json FROM settings WHERE key = 'fx'").get();
  return r ? JSON.parse(String(r.value_json)) : undefined;
};

// The ECB publishes about 30 currencies. The rest (AED, SAR, TWD, VND, most of Latin America and Africa) come from
// fawazahmed0's currency-api: CC0, no key, daily, also per euro. Two hosts of the same files; the ECB's own rates win.
const MORE = ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json', 'https://latest.currency-api.pages.dev/v1/currencies/eur.json'];

async function moreRates(fetchFn: Fetch): Promise<Record<string, number>> {
  for (const url of MORE) {
    const body = (await fetchFn(url).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined)) as { eur?: Record<string, unknown> } | undefined;
    if (body?.eur) return Object.fromEntries(Object.entries(body.eur).filter(([c, v]) => /^[a-z]{3}$/.test(c) && typeof v === 'number' && v > 0).map(([c, v]) => [c.toUpperCase(), v as number]));
  }
  return {};
}

export async function refreshFx(db: Db, fetchFn: Fetch = fetch) {
  const res = await fetchFn(ECB);
  if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
  const ecb = parseEcb(await res.text());
  // SA-53 (decision 19): each day's rates kept by date (the second feed's under the ECB's day); the first run also loads
  // the history the ECB publishes. A failed history read is tried again on the next refresh.
  const fx: Rates = { ...ecb, rates: { ...(await moreRates(fetchFn)), ...ecb.rates }, fetchedAt: new Date().toISOString(), history: cached(db)?.history };
  storeRates(db, [[fx.date, fx.rates]]);
  if (!fx.history)
    fx.history = await ecbHistory(fetchFn).then(
      (days) => (storeRates(db, days), true),
      (e: unknown) => void log('warn', 'fx history failed', { error: e instanceof Error ? e.message : String(e) }),
    );
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(fx));
  return fx;
}

/** Rates per day into fx_rates; a day already stored keeps its rates (the daily file and the history agree). */
function storeRates(db: Db, days: Iterable<readonly [string, Record<string, number>]>) {
  const put = db.prepare('INSERT OR IGNORE INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)');
  tx(db, () => {
    for (const [date, rates] of days) for (const [cur, rate] of Object.entries(rates)) if (cur !== 'EUR') put.run(date, cur, rate);
  });
}

/** Every day the ECB has published since 1999, per euro. One download (about 1 MB compressed). */
async function ecbHistory(fetchFn: Fetch) {
  const res = await fetchFn(ECB_HISTORY);
  if (!res.ok) throw new Error(`ECB rate history: HTTP ${res.status}`);
  return new Map((await res.text()).split('<Cube time=').slice(1).map((day) => {
    const { date, rates } = parseEcb(`time=${day}`);
    return [date, rates] as const;
  }));
}

/**
 * The currency a query over `storeIds` reports in, and each store's factor into it: one store stays in its own
 * currency, several are converted to the base currency. A store whose currency has no rate (not published by the ECB,
 * or nothing fetched yet) gets 0: callers leave it out, and `unconverted` lists those currencies.
 */
export function fxFor(db: Db, storeIds: string[]) {
  const stores = new Map(
    storeIds.length ? db.prepare(`SELECT id, currency FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`).all(...storeIds).map((r) => [String(r.id), String(r.currency)]) : [],
  );
  const currency = storeIds.length === 1 ? (stores.get(storeIds[0]!) ?? 'USD') : getSettings(db).baseCurrency;
  const rates = [...stores.values()].some((c) => c !== currency) ? cached(db)?.rates : undefined;
  // SA-53: with a day, that day's stored rate (or the last within 7 days).
  // ponytail: a day with no stored rate (a second-feed currency before its first fetch, or before the history loads)
  // takes the latest, as before: leaving it out needs `unconverted` per day in the summary.
  const rate = (storeId: string, day?: string) => {
    const from = stores.get(storeId) ?? currency;
    if (from === currency) return 1;
    const onDay = day ? convertOn(db, day, from, currency) : null;
    if (onDay) return onDay;
    return rates?.[from] && rates[currency] ? rates[currency] / rates[from] : 0;
  };
  const unconverted = [...new Set(storeIds.filter((id) => !rate(id)).map((id) => stores.get(id)!))];
  return { currency, rate, unconverted };
}

/** Units of `to` per unit of `from` from the stored rates, with their date, never fetching (product-research's Rank step). */
export function storedRate(db: Db, from: string, to: string): { rate: number; date: string | null } | undefined {
  if (from === to) return { rate: 1, date: null };
  const fx = cached(db);
  return fx?.rates[from] && fx.rates[to] ? { rate: fx.rates[to] / fx.rates[from], date: fx.date } : undefined;
}

/**
 * Units of `to` per unit of `from` (an ad account billing in another currency than its store), refreshing rates older
 * than a day first. Undefined when the ECB doesn't publish one of them.
 */
export async function convertRate(db: Db, from: string, to: string, fetchFn: Fetch = fetch) {
  if (from === to) return 1;
  let fx = cached(db);
  if (!fx?.fetchedAt || Date.now() - Date.parse(fx.fetchedAt) > 24 * 3_600_000) fx = await refreshFx(db, fetchFn).catch(() => fx);
  return fx?.rates[from] && fx.rates[to] ? fx.rates[to] / fx.rates[from] : undefined;
}

/**
 * Units of `to` per unit of `from` on each day since 1999: the ECB's rate that day, or on a weekend or holiday the last
 * one published in the week before. Undefined when there's none. One download (about 1 MB compressed).
 */
export async function historicRate(from: string, to: string, fetchFn: Fetch = fetch) {
  const days = await ecbHistory(fetchFn);
  return (day: string) => {
    for (let i = 0; i < 7; i++) {
      const r = days.get(addDays(day, -i));
      if (r?.[from] && r[to]) return r[to] / r[from];
    }
  };
}

/**
 * Refetches rates older than 12 h while any store's currency differs from the base currency. Checked every 10 min, so
 * a store that just changed currency gets rates soon; after a failure it waits an hour. Returns stop().
 */
export function startFxLoop(db: Db, fetchFn: Fetch = fetch) {
  let failedAt = 0;
  const check = () => {
    if (!db.prepare('SELECT 1 FROM stores WHERE currency != ?').get(getSettings(db).baseCurrency)) return;
    const at = cached(db)?.fetchedAt;
    if ((at && Date.now() - Date.parse(at) < 12 * 3_600_000) || Date.now() - failedAt < 3_600_000) return;
    refreshFx(db, fetchFn).catch((e) => {
      failedAt = Date.now();
      log('warn', 'fx refresh failed', { error: e instanceof Error ? e.message : String(e) });
    });
  };
  check();
  const timer = setInterval(check, 10 * 60_000);
  return () => clearInterval(timer);
}
