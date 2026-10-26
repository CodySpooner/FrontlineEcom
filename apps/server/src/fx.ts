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

export async function refreshFx(db: Db, fetchFn: Fetch = fetch) {
  const res = await fetchFn(ECB);
  if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
  const fx = { ...parseEcb(await res.text()), fetchedAt: new Date().toISOString() };
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
