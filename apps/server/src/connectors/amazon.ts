import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { rebuildRevenue, switchToReal } from './common';

// Amazon Selling Partner API, read-only analytics first: daily sales + order counts from the Sales API (one call covers
// two years, where the Orders API allows about one request a minute). LWA refresh token from a private SP-API app.
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const HOSTS: Record<string, string> = { na: 'sellingpartnerapi-na.amazon.com', eu: 'sellingpartnerapi-eu.amazon.com', fe: 'sellingpartnerapi-fe.amazon.com' };
/** The Sales API serves up to two years back. */
const BACKFILL_DAYS = 729;
/** Recent days still change (cancellations, late orders), so later syncs re-pull them. */
const SETTLE_DAYS = 14;

type Fetch = typeof fetch;

/** "+02:00" / "-07:00": `timeZone`'s UTC offset at local midnight starting `date`. */
export function midnightOffset(timeZone: string, date: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const minutes = (ms: number) => {
    const m = /GMT([+-])(\d\d):(\d\d)/.exec(fmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')!.value);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  };
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  const off = minutes(utcMidnight - minutes(utcMidnight) * 60_000);
  const abs = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export async function syncAmazon(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `amazon:${storeId}`;
  const creds = getCredentials(db, key, 'amazon', storeId);
  if (!creds) return;
  try {
    const host = HOSTS[creds.region!.trim().toLowerCase()];
    if (!host) throw new Error('Region must be na, eu or fe');
    const marketplace = creds.marketplaceId!.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,16}$/.test(marketplace)) throw new Error('Marketplace ID must look like ATVPDKIKX0DER');

    const lwa = await fetchFn(LWA_TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken!, client_id: creds.clientId!, client_secret: creds.clientSecret! }),
    });
    const auth = (await lwa.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!lwa.ok || !auth.access_token) throw new Error(`Amazon sign-in failed: ${auth.error_description ?? auth.error ?? `HTTP ${lwa.status}`}; check the LWA client and refresh token`);

    const timeZone = String(db.prepare('SELECT timezone FROM stores WHERE id = ?').get(storeId)?.timezone ?? 'UTC');
    const today = localDate(now);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const start = cursor ? addDays(cursor, -SETTLE_DAYS) : addDays(today, -BACKFILL_DAYS);
    const end = addDays(today, 1);
    const params = new URLSearchParams({
      marketplaceIds: marketplace,
      interval: `${start}T00:00:00${midnightOffset(timeZone, start)}--${end}T00:00:00${midnightOffset(timeZone, end)}`,
      granularity: 'Day',
      granularityTimeZone: timeZone,
    });
    const res = await fetchFn(`https://${host}/sales/v1/orderMetrics?${params}`, { headers: { 'x-amz-access-token': auth.access_token } });
    const body = (await res.json().catch(() => ({}))) as { payload?: { interval: string; orderCount: number; totalSales: { amount: number } }[]; errors?: { message: string }[] };
    if (res.status === 403) throw new Error('Amazon refused access; the SP-API app needs the Selling Partner Insights (sales) role for this seller');
    if (!res.ok) throw new Error(`Amazon: ${body.errors?.[0]?.message ?? `HTTP ${res.status}`}`);

    tx(db, () => {
      switchToReal(db, storeId);
      const up = db.prepare(
        `INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES (?, 'amazon', ?, ?, ?)
         ON CONFLICT (store_id, channel, date) DO UPDATE SET revenue = excluded.revenue, orders = excluded.orders`,
      );
      const days = new Set<string>();
      for (const d of body.payload ?? []) {
        const date = d.interval.slice(0, 10);
        days.add(date);
        up.run(storeId, date, Number(d.totalSales?.amount ?? 0), d.orderCount ?? 0);
      }
      rebuildRevenue(db, storeId, days);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(today, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Amazon sync failed');
  }
}
