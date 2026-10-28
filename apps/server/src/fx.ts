import { addDays } from './dates';
import type { Db } from './db';
import { log } from './log';
import { getSettings } from './settings';

// ECB euro reference rates (published ~16:00 CET on working days), cached in settings so totals work offline.
const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

type Fetch = typeof fetch;
interface Rates {
  date: string;
  fetchedAt?: string;
  /** Units of each currency per 1 EUR. */
  rates: Record<string, number>;
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
  const fx = { ...ecb, rates: { ...(await moreRates(fetchFn)), ...ecb.rates }, fetchedAt: new Date().toISOString() };
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(fx));
  return fx;
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
  const rate = (storeId: string) => {
    const from = stores.get(storeId) ?? currency;
    if (from === currency) return 1;
    return rates?.[from] && rates[currency] ? rates[currency] / rates[from] : 0;
  };
  const unconverted = [...new Set(storeIds.filter((id) => !rate(id)).map((id) => stores.get(id)!))];
  return { currency, rate, unconverted };
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
  const res = await fetchFn('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml');
  if (!res.ok) throw new Error(`ECB rate history: HTTP ${res.status}`);
  const days = new Map((await res.text()).split('<Cube time=').slice(1).map((day) => {
    const { date, rates } = parseEcb(`time=${day}`);
    return [date, rates] as const;
  }));
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
