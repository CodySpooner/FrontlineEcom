import type { ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { rebuildRevenue, setOrderItems, switchToReal } from './common';

// WooCommerce REST API v3 with a read-only consumer key/secret (Basic auth, so https only).
/** First sync pulls this many days of orders (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;

type Fetch = typeof fetch;

interface WooOrder {
  number: string;
  status: string;
  currency: string;
  /** In the shop's own timezone, so its date is the shop's day. */
  date_created: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  date_paid_gmt: string | null;
  total: string;
  line_items?: { product_id: number; quantity: number; total: string; cost_of_goods_sold?: { value: number } }[];
  /** Only when the store has WooCommerce's Cost of Goods Sold feature on (Settings → Advanced → Features, Woo 9.5+). */
  cost_of_goods_sold?: { total_value: number };
}

interface WooProduct {
  id: number;
  name: string;
  status: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  images?: { src: string }[];
  date_modified_gmt: string;
  cost_of_goods_sold?: { total_value: number };
}

/** Woo's *_gmt dates have no zone suffix. */
const gmt = (s: string) => new Date(`${s}Z`);

/** "https://shop.com/" → "https://shop.com"; keys travel in a Basic header, so plain http is refused. */
export function wooSite(url: string) {
  const u = URL.canParse(url.trim()) ? new URL(url.trim()) : undefined;
  if (u?.protocol !== 'https:') throw new Error('Site URL must start with https:// (the keys are sent with every request)');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export async function syncWooCommerce(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `woocommerce:${storeId}`;
  const creds = getCredentials(db, key, 'woocommerce', storeId);
  if (!creds) return;
  try {
    const site = wooSite(creds.siteUrl!);
    const auth = `Basic ${Buffer.from(`${creds.consumerKey!.trim()}:${creds.consumerSecret!.trim()}`).toString('base64')}`;
    const all = async <T>(path: string, params: Record<string, string>) => {
      const out: T[] = [];
      for (let page = 1, pages = 1; page <= pages; page++) {
        const res = await fetchFn(`${site}/wp-json/wc/v3/${path}?${new URLSearchParams({ ...params, per_page: '100', page: String(page) })}`, { headers: { authorization: auth } });
        const body = (await res.json().catch(() => undefined)) as T[] | { message?: string } | undefined;
        if (res.status === 401 || res.status === 403) throw new Error('WooCommerce refused the keys; create a Read key under WooCommerce → Settings → Advanced → REST API');
        if (!body) throw new Error(`No WooCommerce API at ${site}/wp-json; check the Site URL (and that permalinks are not "Plain")`);
        if (!res.ok || !Array.isArray(body)) throw new Error(`WooCommerce: ${(body as { message?: string }).message ?? `HTTP ${res.status}`}`);
        out.push(...body);
        pages = Number(res.headers.get('x-wp-totalpages') ?? 1);
      }
      return out;
    };

    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ?? new Date(now.getTime() - BACKFILL_DAYS * 86_400_000).toISOString().slice(0, 19);
    // Default order (newest created first): edits don't move an order between pages, so paging can't skip it.
    const changed = { modified_after: since, dates_are_gmt: 'true' };
    const orders = await all<WooOrder>('orders', changed);
    const products = await all<WooProduct>('products', changed);

    tx(db, () => {
      switchToReal(db, storeId);
      // ponytail: newest order's currency (orders come newest first); a multi-currency plugin's mixed orders aren't split.
      if (orders[0]?.currency) db.prepare('UPDATE stores SET currency = ? WHERE id = ?').run(orders[0].currency, storeId);
      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, compare_at = excluded.compare_at,
           cost = excluded.cost, inventory = excluded.inventory, status = excluded.status`,
      );
      for (const p of products) {
        const price = Number(p.price || p.regular_price || 0);
        const regular = Number(p.regular_price || 0);
        const status: ProductStatus = p.status === 'publish' ? 'active' : 'draft';
        prod.run(storeId, `woo-${p.id}`, p.name, p.images?.[0]?.src ?? null, price, regular > price ? regular : null, Number(p.cost_of_goods_sold?.total_value ?? 0), p.stock_quantity ?? 0, status);
      }
      // Costs come from Woo's own Cost of Goods Sold feature when it's on (cogs 0 otherwise); tracking needs a plugin.
      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status, cogs = excluded.cogs`,
      );
      const days = new Set<string>();
      for (const o of orders) {
        // Unpaid (pending, on-hold bank transfers, failed, drafts) never counts; cancelled or refunded after payment is a refund.
        if (!o.date_paid_gmt) continue;
        const created = gmt(o.date_created_gmt);
        const day = o.date_created.slice(0, 10);
        days.add(day);
        const refunded = o.status === 'refunded' || o.status === 'cancelled' || o.status === 'trash';
        ord.run(storeId, `woo-${o.number}`, created.toISOString(), Number(o.total), refunded ? 'refunded' : 'paid', o.status === 'completed' ? 'fulfilled' : 'unfulfilled', Number(o.cost_of_goods_sold?.total_value ?? 0), day);
        setOrderItems(db, storeId, `woo-${o.number}`, (o.line_items ?? []).filter((li) => li.product_id).map((li) => ({ productId: `woo-${li.product_id}`, quantity: li.quantity, revenue: Number(li.total), cost: Number(li.cost_of_goods_sold?.value ?? 0) })));
      }
      rebuildRevenue(db, storeId, days);
      const newest = [...orders, ...products].reduce((m, x) => (x.date_modified_gmt > m ? x.date_modified_gmt : m), since);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(newest, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'WooCommerce sync failed');
  }
}
