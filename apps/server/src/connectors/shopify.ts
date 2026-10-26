import type { FulfillmentStatus, ProductStatus } from '@frontline/shared';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus } from '../integrations';
import { rebuildRevenue, switchToReal } from './common';

// Shopify Admin GraphQL, custom-app access token. Scopes: read_products, read_inventory, read_orders, read_all_orders;
// write_products to add products the owner approved (createProducts).
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

// Shopify prices a query before running it (max 1000): objects 1, connections 2 + first × child. Per order:
// 1 + total 2 + fulfillment 2 + lineItems (2 + 20 × 4) = 87, so 10 orders = 872. Products: 2 + 50 × 9 = 452.
// ponytail: orders with more than 20 line items undercount cogs.
const ORDERS_Q = `query ($after: String, $q: String) {
  orders(first: 10, after: $after, query: $q, sortKey: UPDATED_AT) {
    nodes { name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount } }
      fulfillments(first: 1) { displayStatus trackingInfo(first: 1) { number } }
      lineItems(first: 20) { nodes { quantity variant { inventoryItem { unitCost { amount } } } } } }
    pageInfo { hasNextPage endCursor } } }`;

// productCreate makes one default variant; its price and cost are set right after.
const CREATE_M = `mutation ($product: ProductCreateInput!) {
  productCreate(product: $product) { product { id variants(first: 1) { nodes { id } } } userErrors { message } } }`;

const VARIANT_M = `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } } }`;

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
      switchToReal(db, storeId);
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

      rebuildRevenue(db, storeId, days);

      const newest = [...products, ...orders].reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), since);
      db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(newest, now.toISOString(), id);
    });
  } catch (e) {
    setIntegrationStatus(db, id, 'error', e instanceof Error ? e.message : 'Shopify sync failed');
  }
}

export interface NewProduct {
  title: string;
  price: number;
  compareAt?: number;
  cost?: number;
}

/**
 * Creates each product in Shopify as a draft and adds it to the local catalog right away (the next sync refreshes it).
 * Call only for an approved request. Throws on the first failure; products created before it stay as drafts, and a
 * product whose price update failed stays a $0 draft in Shopify until the next sync shows it.
 */
export async function createProducts(db: Db, key: Buffer, storeId: string, products: NewProduct[], fetchFn: Fetch = fetch) {
  const creds = getCredentials(db, key, 'shopify', storeId);
  if (!creds) throw new Error('Shopify is not connected for this store');
  const q = <T>(query: string, vars: Record<string, unknown>) => gql<T>(shopHost(creds.shopDomain!), creds.accessToken!, query, vars, fetchFn);
  const check = (errors: { message: string }[]) => {
    if (errors.length) throw new Error(`Shopify: ${errors.map((e) => e.message).join('; ')}`);
  };
  const insert = db.prepare(`INSERT OR IGNORE INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'draft')`);
  const created: { id: string; title: string }[] = [];
  for (const p of products) {
    type Created = { productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: { message: string }[] } };
    const { productCreate: c } = await q<Created>(CREATE_M, { product: { title: p.title, status: 'DRAFT' } });
    check(c.userErrors);
    const product = c.product!;
    const variant = { id: product.variants.nodes[0]!.id, price: p.price.toFixed(2), ...(p.compareAt ? { compareAtPrice: p.compareAt.toFixed(2) } : {}), ...(p.cost ? { inventoryItem: { cost: p.cost.toFixed(2) } } : {}) };
    const { productVariantsBulkUpdate: u } = await q<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(VARIANT_M, { productId: product.id, variants: [variant] });
    check(u.userErrors);
    insert.run(storeId, tail(product.id), p.title, p.price, p.compareAt ?? null, p.cost ?? 0);
    created.push({ id: tail(product.id), title: p.title });
  }
  return created;
}
