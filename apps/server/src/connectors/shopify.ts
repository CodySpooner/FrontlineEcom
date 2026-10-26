import type { FulfillmentStatus, ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';

// Shopify Admin GraphQL, custom-app access token. Scopes: read_products, read_inventory, read_orders, read_all_orders.
export const SHOPIFY_API_VERSION = '2026-07';
/** First sync pulls this many days of orders (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;

type Fetch = typeof fetch;
type Money = { amount: string } | null;
interface PageInfo { hasNextPage: boolean; endCursor: string | null }

interface ShopifyProduct {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  totalInventory: number | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  variants: { nodes: { price: string; compareAtPrice: string | null; inventoryItem: { unitCost: Money } | null }[] };
}

interface ShopifyOrder {
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string } };
  fulfillments: { displayStatus: string | null; trackingInfo: { number: string | null }[] }[];
  lineItems: { nodes: { quantity: number; variant: { inventoryItem: { unitCost: Money } | null } | null }[] };
}

const SHOP_Q = `{ shop { name currencyCode ianaTimezone } }`;

const PRODUCTS_Q = `query ($after: String, $q: String) {
  products(first: 50, after: $after, query: $q) {
    nodes { id title status updatedAt totalInventory
      featuredMedia { preview { image { url } } }
      variants(first: 1) { nodes { price compareAtPrice inventoryItem { unitCost { amount } } } } }
    pageInfo { hasNextPage endCursor } } }`;

// ponytail: 25 orders × 20 line items keeps query cost under Shopify's 1000 limit; orders with >20 lines undercount cogs
const ORDERS_Q = `query ($after: String, $q: String) {
  orders(first: 25, after: $after, query: $q, sortKey: UPDATED_AT) {
    nodes { name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount } }
      fulfillments(first: 1) { displayStatus trackingInfo(first: 1) { number } }
      lineItems(first: 20) { nodes { quantity variant { inventoryItem { unitCost { amount } } } } } }
    pageInfo { hasNextPage endCursor } } }`;

/** "https://Glow.myshopify.com/" → "glow.myshopify.com"; anything that isn't a myshopify.com host is rejected so the token only goes to Shopify. */
export function shopHost(domain: string) {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) throw new Error('Shop domain must look like your-store.myshopify.com');
  return host;
}

async function gql<T>(host: string, token: string, query: string, variables: Record<string, unknown>, fetchFn: Fetch): Promise<T> {
  const res = await fetchFn(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`Shopify rejected the access token (HTTP ${res.status}); check the token and its scopes`);
  if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(`Shopify: ${body.errors?.map((e) => e.message).join('; ') ?? 'empty response'}`);
  return body.data;
}

async function all<N>(fetchPage: (after: string | null) => Promise<{ nodes: N[]; pageInfo: PageInfo }>): Promise<N[]> {
  const out: N[] = [];
  let after: string | null = null;
  do {
    const page = await fetchPage(after);
    out.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return out;
}

const tail = (gid: string) => gid.slice(gid.lastIndexOf('/') + 1);
const num = (m: Money | string | null | undefined) => Number((typeof m === 'string' ? m : m?.amount) ?? 0);

export function fulfillmentOf(o: Pick<ShopifyOrder, 'displayFulfillmentStatus' | 'fulfillments'>): FulfillmentStatus {
  const shipment = o.fulfillments[0]?.displayStatus;
  if (shipment === 'DELIVERED') return 'delivered';
  if (shipment === 'IN_TRANSIT' || shipment === 'OUT_FOR_DELIVERY' || shipment === 'ATTEMPTED_DELIVERY') return 'in_transit';
  return o.displayFulfillmentStatus === 'FULFILLED' ? 'fulfilled' : 'unfulfilled';
}

/** Wipes a demo store's generated rows and marks it connected (first successful real sync). */
function switchToReal(db: Db, storeId: string) {
  for (const t of ['daily_metrics', 'products', 'orders', 'campaigns', 'events']) db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(storeId);
  db.prepare('UPDATE stores SET demo = 0, connected = 1 WHERE id = ?').run(storeId);
}

/** Pulls shop, products and orders updated since the last sync and rebuilds revenue/orders/cogs for the touched days. */
export async function syncShopify(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `shopify:${storeId}`;
  const creds = getCredentials(db, key, 'shopify', storeId);
  if (!creds) return;
  try {
    const host = shopHost(creds.shopDomain!);
    const q = <T>(query: string, vars: Record<string, unknown> = {}) => gql<T>(host, creds.accessToken!, query, vars, fetchFn);
    const { shop } = await q<{ shop: { currencyCode: string; ianaTimezone: string } }>(SHOP_Q);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ?? `${addDays(localDate(now), -BACKFILL_DAYS)}T00:00:00Z`;
    const filter = `updated_at:>='${since}'`;
    const products = await all((after) => q<{ products: { nodes: ShopifyProduct[]; pageInfo: PageInfo } }>(PRODUCTS_Q, { after, q: filter }).then((d) => d.products));
    const orders = await all((after) => q<{ orders: { nodes: ShopifyOrder[]; pageInfo: PageInfo } }>(ORDERS_Q, { after, q: filter }).then((d) => d.orders));
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: shop.ianaTimezone });

    tx(db, () => {
      if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo === 1) switchToReal(db, storeId);
      db.prepare('UPDATE stores SET connected = 1, currency = ?, timezone = ? WHERE id = ?').run(shop.currencyCode, shop.ianaTimezone, storeId);

      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, compare_at = excluded.compare_at,
           cost = excluded.cost, inventory = excluded.inventory, status = excluded.status`,
      );
      for (const p of products) {
        const v = p.variants.nodes[0];
        const compareAt = v?.compareAtPrice ? num(v.compareAtPrice) : null;
        prod.run(storeId, tail(p.id), p.title, p.featuredMedia?.preview?.image?.url ?? null, num(v?.price), compareAt, num(v?.inventoryItem?.unitCost), p.totalInventory ?? 0, p.status.toLowerCase() as ProductStatus);
      }

      const ord = db.prepare(
        `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status,
           tracking = excluded.tracking, cogs = excluded.cogs`,
      );
      const days = new Set<string>();
      for (const o of orders) {
        if (o.test) continue;
        const refunded = !!o.cancelledAt || o.displayFinancialStatus === 'REFUNDED' || o.displayFinancialStatus === 'VOIDED';
        const cogs = o.lineItems.nodes.reduce((a, li) => a + li.quantity * num(li.variant?.inventoryItem?.unitCost), 0);
        const day = dayOf.format(new Date(o.createdAt));
        days.add(day);
        ord.run(storeId, o.name, o.createdAt, num(o.currentTotalPriceSet.shopMoney.amount), refunded ? 'refunded' : 'paid', fulfillmentOf(o), o.fulfillments[0]?.trackingInfo[0]?.number ?? null, Math.round(cogs * 100) / 100, day);
      }

      // ad_spend is left alone: the ad connectors own it.
      const agg = db.prepare("SELECT coalesce(sum(total), 0) AS revenue, coalesce(sum(cogs), 0) AS cogs, count(*) AS n FROM orders WHERE store_id = ? AND local_date = ? AND status = 'paid'");
      const up = db.prepare(
        `INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id, date) DO UPDATE SET revenue = excluded.revenue, cogs = excluded.cogs, orders = excluded.orders`,
      );
      for (const day of days) {
        const a = agg.get(storeId, day)!;
        up.run(storeId, day, Math.round(Number(a.revenue) * 100) / 100, Math.round(Number(a.cogs) * 100) / 100, Number(a.n));
      }

      const newest = [...products, ...orders].reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), since);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(newest, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Shopify sync failed');
  }
}
