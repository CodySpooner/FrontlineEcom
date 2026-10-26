import type { FulfillmentStatus, SupplierProduct } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';

// CJ Dropshipping API 2.0, read-only first: order status + tracking for orders the owner's stores sent to CJ, catalog search.
// One account serves every store (global integration). CJ allows one call per second.
const API = 'https://developers.cjdropshipping.com/api2.0/v1';
const ID = 'cj:global';
/** Orders paid in this window are still worth watching (CJ shipping takes 1–3 weeks). */
const WINDOW_DAYS = 30;
const STATUSES = ['UNSHIPPED', 'SHIPPED', 'DELIVERED'] as const;
const PAGE_SIZE = 20;

type Fetch = typeof fetch;
interface CjResponse<T> { code: number; result: boolean; message: string; data: T }
interface CjOrder { orderNum: string | null; shopName: string | null; orderStatus: string; trackNumber: string | null }

const RANK: FulfillmentStatus[] = ['unfulfilled', 'fulfilled', 'in_transit', 'delivered'];
const CJ_STATUS: Record<string, FulfillmentStatus> = { SHIPPED: 'in_transit', DELIVERED: 'delivered' };

async function call<T>(fetchFn: Fetch, path: string, init: RequestInit): Promise<T> {
  const res = await fetchFn(`${API}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as Partial<CjResponse<T>>;
  if (!res.ok || !body.result) throw new Error(`CJ: ${body.message ?? `HTTP ${res.status}`}`);
  return body.data as T;
}

/** Cached access token, renewed from the API key a day before it expires (CJ serves the same token for 24h anyway). */
async function accessToken(db: Db, key: Buffer, creds: Record<string, string>, fetchFn: Fetch, now: Date) {
  if (creds.accessToken && Number(creds.accessTokenExpiresAt) * 1000 > now.getTime() + 86_400_000) return creds.accessToken;
  const t = await call<{ accessToken: string; accessTokenExpiryDate: string }>(fetchFn, '/authentication/getAccessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: creds.apiKey!.trim() }),
  });
  updateSecrets(db, key, ID, { accessToken: t.accessToken, accessTokenExpiresAt: String(Math.floor(Date.parse(t.accessTokenExpiryDate) / 1000)) });
  return t.accessToken;
}

const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export async function syncCj(db: Db, key: Buffer, _storeId: string, fetchFn: Fetch = fetch, now = new Date(), gapMs = 1100) {
  const creds = getCredentials(db, key, 'cj');
  if (!creds) return;
  try {
    const token = await accessToken(db, key, creds, fetchFn, now);
    const orders: CjOrder[] = [];
    for (const status of STATUSES) {
      for (let page = 1; ; page++) {
        await new Promise((r) => setTimeout(r, gapMs));
        const q = new URLSearchParams({ pageNum: String(page), pageSize: String(PAGE_SIZE), status, paymentDateFrom: utc(new Date(now.getTime() - WINDOW_DAYS * 86_400_000)), paymentDateTo: utc(now) });
        const data = await call<{ total: number; list: CjOrder[] | null }>(fetchFn, `/shopping/order/list?${q}`, { headers: { 'CJ-Access-Token': token } });
        orders.push(...(data.list ?? []));
        if (!data.list?.length || page * PAGE_SIZE >= data.total) break;
      }
    }

    tx(db, () => {
      // CJ's order number is the store platform's: "#1001"/"1001" on Shopify, the TikTok Shop order id, the Etsy receipt id.
      const find = db.prepare(
        `SELECT o.store_id, o.id, o.fulfillment_status, lower(s.name) AS store FROM orders o JOIN stores s ON s.id = o.store_id
         WHERE o.id IN (?1, '#' || ?1, 'tt-' || ?1, 'etsy-' || ?1)`,
      );
      const up = db.prepare("UPDATE orders SET supplier = 'CJ Dropshipping', tracking = coalesce(?, tracking), fulfillment_status = ? WHERE store_id = ? AND id = ?");
      for (const o of orders) {
        if (!o.orderNum) continue;
        let hits = find.all(o.orderNum.replace(/^#/, ''));
        // Several stores can share an order number (every Shopify store starts at #1001): CJ's shop name picks one, else skip.
        if (hits.length > 1) hits = hits.filter((h) => h.store === o.shopName?.trim().toLowerCase());
        if (hits.length !== 1) continue;
        const h = hits[0]!;
        const cur = h.fulfillment_status as FulfillmentStatus;
        const cj = CJ_STATUS[o.orderStatus];
        const status = cj && RANK.indexOf(cj) > RANK.indexOf(cur) ? cj : cur;
        up.run(o.trackNumber || null, status, String(h.store_id), String(h.id));
      }
      db.prepare("UPDATE integrations SET synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(now.toISOString(), ID);
    });
  } catch (e) {
    setIntegrationStatus(db, ID, 'error', e instanceof Error ? e.message : 'CJ sync failed');
  }
}

interface CjProduct { id: string; sku: string; nameEn: string; bigImage?: string; sellPrice: string | number; listedNum?: number }

/**
 * CJ catalog search by product name or SKU. Undefined when CJ isn't connected. Throws "CJ: <message>".
 * ponytail: no shared limiter with syncCj, so a search during a sync can hit CJ's 1 call/second limit and show its error.
 */
export async function searchCj(db: Db, key: Buffer, q: string, limit: number, fetchFn: Fetch = fetch, now = new Date()): Promise<SupplierProduct[] | undefined> {
  const creds = getCredentials(db, key, 'cj');
  if (!creds) return undefined;
  const token = await accessToken(db, key, creds, fetchFn, now);
  const params = new URLSearchParams({ keyWord: q, page: '1', size: String(limit) });
  const data = await call<{ content?: { productList?: CjProduct[] }[] }>(fetchFn, `/product/listV2?${params}`, { headers: { 'CJ-Access-Token': token } });
  return (data.content ?? []).flatMap((c) => c.productList ?? []).slice(0, limit).map((p) => ({
    supplier: 'cj',
    id: String(p.id),
    sku: String(p.sku),
    title: p.nameEn,
    ...(p.bigImage ? { image: p.bigImage } : {}),
    // A product with variants at different prices reports a range ("2.47 -- 3.10"): keep the lowest.
    price: parseFloat(String(p.sellPrice)) || 0,
    listed: Number(p.listedNum ?? 0),
  }));
}

/** Zero-credential stand-in: research catalog products matching the query, at their supplier cost. */
export function demoSupplierProducts(db: Db, q: string, limit: number): SupplierProduct[] {
  return db
    .prepare('SELECT id, title, image, cost, competition FROM research_products WHERE title LIKE ? ORDER BY cost LIMIT ?')
    .all(`%${q}%`, limit)
    .map((r) => ({
      supplier: 'cj',
      id: `demo-${r.id}`,
      sku: `CJ${String(r.id).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}`,
      title: String(r.title),
      ...(r.image ? { image: String(r.image) } : {}),
      price: Number(r.cost),
      listed: Math.round(Number(r.competition) * 40),
      demo: true,
    }));
}
