import type { FulfillmentStatus, ProductStatus } from '@frontline/shared';
import { logAction } from '../actions';
import { tx, type Db } from '../db';
import { addDays, localDate } from '../dates';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { archiveMissing, catalogPassDue, cursorAt, rebuildRevenue, setOrderItems, setStoreCurrency, switchToReal } from './common';

// Shopify Admin GraphQL, custom-app access token. Scopes: read_products, read_inventory, read_orders, read_all_orders;
// write_products to add products the owner approved (createProducts) or publish product pages (publishProductPage);
// write_online_store_pages for store pages (publishPage); read_reports (+ Level 2 customer data) for the funnel.
export const SHOPIFY_API_VERSION = '2026-07';
/** First sync pulls this many days of orders (1Y range + the previous year for deltas). */
const BACKFILL_DAYS = 730;

type Fetch = typeof fetch;
type Money = { amount: string } | null;
interface PageInfo { hasNextPage: boolean; endCursor: string | null }

/** ShopifyQL's table: rows as arrays in column order or as objects by column name (the docs show neither). */
type Table = { columns: { name: string }[]; rows: unknown } | null;
const FUNNEL_Q = `query ($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }`;

/** Daily funnel rows from a ShopifyQL sessions table. */
export function funnelDays(t: Table) {
  const at = (r: unknown, name: string) => (Array.isArray(r) ? r[t!.columns.findIndex((c) => c.name === name)] : (r as Record<string, unknown>)?.[name]);
  return (Array.isArray(t?.rows) ? t.rows : [])
    .map((r) => ({ date: String(at(r, 'day')).slice(0, 10), sessions: Number(at(r, 'sessions')) || 0, carts: Number(at(r, 'sessions_with_cart_additions')) || 0, checkouts: Number(at(r, 'sessions_that_reached_checkout')) || 0 }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
}

interface ShopifyProduct {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  totalInventory: number | null;
  tracksInventory: boolean;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  /** inventoryPolicy CONTINUE keeps selling at 0 (common when dropshipping). */
  variants: { nodes: { price: string; compareAtPrice: string | null; inventoryPolicy?: string; inventoryItem: { unitCost: Money } | null }[] };
}

type LineItem = { quantity: number; product: { id: string } | null; discountedTotalSet: { shopMoney: { amount: string } }; variant: { inventoryItem: { unitCost: Money } | null } | null };
interface ShopifyOrder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  currentTotalPriceSet: { shopMoney: { amount: string } };
  /** Tax in that total, after returns. */
  currentTotalTaxSet?: { shopMoney: { amount: string } };
  /** Prices include tax (VAT stores): line totals then hold it too. */
  taxesIncluded?: boolean;
  fulfillments: { displayStatus: string | null; trackingInfo: { number: string | null }[] }[];
  lineItems: { nodes: LineItem[]; pageInfo: PageInfo };
}

const SHOP_Q = `{ shop { name currencyCode ianaTimezone } }`;

const PRODUCTS_Q = `query ($after: String, $q: String) {
  products(first: 50, after: $after, query: $q) {
    nodes { id title status updatedAt totalInventory tracksInventory
      featuredMedia { preview { image { url(transform: { maxWidth: 480 }) } } }
      variants(first: 1) { nodes { price compareAtPrice inventoryPolicy inventoryItem { unitCost { amount } } } } }
    pageInfo { hasNextPage endCursor } } }`;
const PRODUCT_IDS_Q = `query ($after: String) { products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }`;
const DELETED_Q = `query ($after: String, $q: String) {
  events(first: 250, after: $after, query: $q) { nodes { ... on BasicEvent { subjectId } } pageInfo { hasNextPage endCursor } } }`;

// Shopify prices a query before running it (max 1000): objects 1, connections 2 + first × child. Per order:
// 1 + total 2 + tax 2 + fulfillment 2 + lineItems (2 + 10 × 7 + pageInfo 1) = 80, so 12 orders = 961. Products: 2 + 50 × 9 = 452.
// An order with more line items gets the rest from ORDER_ITEMS_Q (2 + 1 + 100 × 7 + 1 = 704).
const LINE_ITEM = 'quantity product { id } discountedTotalSet { shopMoney { amount } } variant { inventoryItem { unitCost { amount } } }';
const ORDERS_Q = `query ($after: String, $q: String) {
  orders(first: 12, after: $after, query: $q, sortKey: UPDATED_AT) {
    nodes { id name createdAt updatedAt cancelledAt test displayFinancialStatus displayFulfillmentStatus taxesIncluded
      currentTotalPriceSet { shopMoney { amount } } currentTotalTaxSet { shopMoney { amount } }
      fulfillments(first: 1) { displayStatus trackingInfo(first: 1) { number } }
      lineItems(first: 10) { nodes { ${LINE_ITEM} } pageInfo { hasNextPage endCursor } } }
    pageInfo { hasNextPage endCursor } } }`;
const ORDER_ITEMS_Q = `query ($id: ID!, $after: String) {
  order(id: $id) { lineItems(first: 100, after: $after) { nodes { ${LINE_ITEM} } pageInfo { hasNextPage endCursor } } } }`;

// productCreate makes one default variant; its price and cost are set right after.
const CREATE_M = `mutation ($product: ProductCreateInput!) {
  productCreate(product: $product) { product { id variants(first: 1) { nodes { id } } } userErrors { message } } }`;

const VARIANT_M = `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } } }`;

const PRODUCT_UPDATE_M = `mutation ($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id } userErrors { message } } }`;

const VARIANT_IDS_Q = `query ($id: ID!) { product(id: $id) { variants(first: 250) { nodes { id price } pageInfo { hasNextPage } } } }`;

const PAGE_CREATE_M = `mutation ($page: PageCreateInput!) {
  pageCreate(page: $page) { page { id handle } userErrors { message } } }`;

/** "https://Glow.myshopify.com/" → "glow.myshopify.com"; anything that isn't a myshopify.com host is rejected so the token only goes to Shopify. */
export function shopHost(domain: string) {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) throw new Error('Shop domain must look like your-store.myshopify.com');
  return host;
}

interface GqlBody<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost: number; throttleStatus: { currentlyAvailable: number; restoreRate: number } } };
}

/**
 * A query runs only when the app's cost bucket holds its requested cost (an orders page asks 938), so a long sync drains
 * it within a few pages. A throttled query waits until the bucket has refilled enough (at least 1 s) and runs again.
 */
async function gql<T>(host: string, token: string, query: string, variables: Record<string, unknown>, fetchFn: Fetch): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFn(`https://${host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`Shopify rejected the access token (HTTP ${res.status}); check that the app is installed on this store with the scopes it needs`), { auth: true });
    }
    if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status}`);
    const body = (await res.json()) as GqlBody<T>;
    const cost = body.extensions?.cost;
    if (attempt < 10 && body.errors?.some((e) => e.extensions?.code === 'THROTTLED')) {
      const refill = cost ? ((cost.requestedQueryCost - cost.throttleStatus.currentlyAvailable) / cost.throttleStatus.restoreRate) * 1000 : 0;
      await new Promise((r) => setTimeout(r, Math.max(1000, Math.ceil(refill))));
      continue;
    }
    if (body.errors?.length || !body.data) throw new Error(`Shopify: ${body.errors?.map((e) => e.message).join('; ') ?? 'empty response'}`);
    return body.data;
  }
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

/**
 * The Admin API token: a pasted one (legacy custom app), or for a Dev Dashboard app a client-credentials token. Those
 * last 24 h, so one is minted when the cached one has under 5 minutes left and saved (encrypted) with its expiry.
 */
async function adminToken(db: Db, key: Buffer, storeId: string, creds: Record<string, string>, fetchFn: Fetch, now = new Date(), force = false) {
  if (!creds.clientId || !creds.clientSecret) {
    if (!creds.accessToken) throw new Error("Enter your Dev Dashboard app's client ID and secret (or an older custom app's Admin API access token)");
    return creds.accessToken;
  }
  if (!force && creds.grantToken && Number(creds.grantTokenExpiresAt) - now.getTime() > 5 * 60_000) return creds.grantToken;
  const res = await fetchFn(`https://${shopHost(creds.shopDomain!)}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Shopify refused the client ID and secret (${body.error_description ?? body.error ?? `HTTP ${res.status}`}); install the app on this store from the Dev Dashboard, in the same organization`);
  }
  updateSecrets(db, key, `shopify:${storeId}`, { grantToken: body.access_token, grantTokenExpiresAt: String(now.getTime() + (body.expires_in ?? 86399) * 1000) });
  return body.access_token;
}

/** Admin API calls. A client-credentials token Shopify rejects before it expires (app reinstalled, secret rotated) is renewed once. */
function client(db: Db, key: Buffer, storeId: string, creds: Record<string, string>, fetchFn: Fetch, now?: Date) {
  const host = shopHost(creds.shopDomain!);
  let token: Promise<string> | undefined;
  let renewed = false;
  const call = async <T>(query: string, vars: Record<string, unknown> = {}): Promise<T> => {
    token ??= adminToken(db, key, storeId, creds, fetchFn, now);
    try {
      return await gql<T>(host, await token, query, vars, fetchFn);
    } catch (e) {
      if (!(e as { auth?: boolean }).auth || renewed || !creds.clientId || !creds.clientSecret) throw e;
      renewed = true;
      token = adminToken(db, key, storeId, creds, fetchFn, now, true);
      return call<T>(query, vars);
    }
  };
  return call;
}

/**
 * Pulls shop, products and orders updated since the last sync and rebuilds revenue/orders/cogs for the touched days.
 * Orders come oldest update first and each page is saved with the cursor at its last order, so a long first sync
 * (throttled to roughly 17k orders an hour on the base plans) fills the dashboard as it goes and resumes where it stopped.
 */
export async function syncShopify(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch, now = new Date()) {
  const id = `shopify:${storeId}`;
  const creds = getCredentials(db, key, 'shopify', storeId);
  if (!creds) return;
  try {
    const q = client(db, key, storeId, creds, fetchFn, now);
    const { shop } = await q<{ shop: { currencyCode: string; ianaTimezone: string } }>(SHOP_Q);
    const cursor = db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(id)?.cursor as string | null;
    const since = cursor ?? `${addDays(localDate(now), -BACKFILL_DAYS)}T00:00:00Z`;
    const filter = `updated_at:>='${since}'`;
    // The first sync reads every product, however long unchanged; the backfill window is for orders.
    const products = await all((after) => q<{ products: { nodes: ShopifyProduct[]; pageInfo: PageInfo } }>(PRODUCTS_Q, { after, q: cursor ? filter : null }).then((d) => d.products));
    // A deleted product just stops coming back, so its delete event archives it here. Failing to read events never stops a sync.
    const deleted = !cursor ? [] : await all((after) =>
      q<{ events: { nodes: { subjectId?: string }[]; pageInfo: PageInfo } }>(DELETED_Q, { after, q: `action:'destroy' AND subject_type:'PRODUCT' AND created_at:>='${since}'` }).then((d) => d.events),
    ).catch(() => []);
    // And once a day every product id (250 a page), for deletions the events above don't cover: before they were read, or
    // past their retention. A failed read archives nothing.
    const today = localDate(now);
    const catalog = !cursor || !catalogPassDue(db, id, today) ? undefined
      : await all((after) => q<{ products: { nodes: { id: string }[]; pageInfo: PageInfo } }>(PRODUCT_IDS_Q, { after }).then((d) => d.products)).catch(() => undefined);
    const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: shop.ianaTimezone });
    // A page's resume point never passes the sync start, so a product edited while orders page in is fetched again.
    const start = cursorAt(now).toISOString().replace(/\.\d{3}Z$/, 'Z');

    tx(db, () => {
      switchToReal(db, storeId);
      setStoreCurrency(db, storeId, shop.currencyCode);
      db.prepare('UPDATE stores SET connected = 1, timezone = ? WHERE id = ?').run(shop.ianaTimezone, storeId);

      const prod = db.prepare(
        `INSERT INTO products (store_id, id, title, image, price, compare_at, cost, inventory, inventory_tracked, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (store_id, id) DO UPDATE SET title = excluded.title, image = excluded.image, price = excluded.price, compare_at = excluded.compare_at,
           cost = CASE WHEN excluded.cost > 0 THEN excluded.cost ELSE cost END, inventory = excluded.inventory, inventory_tracked = excluded.inventory_tracked, status = excluded.status`,
      );
      for (const p of products) {
        // ponytail: the first variant stands for all (price, cost, inventory policy).
        const v = p.variants.nodes[0];
        const compareAt = v?.compareAtPrice ? num(v.compareAtPrice) : null;
        prod.run(storeId, tail(p.id), p.title, p.featuredMedia?.preview?.image?.url ?? null, num(v?.price), compareAt, num(v?.inventoryItem?.unitCost), p.totalInventory ?? 0, p.tracksInventory === false || v?.inventoryPolicy === 'CONTINUE' ? 0 : 1, p.status.toLowerCase() as ProductStatus);
      }
      const archive = db.prepare("UPDATE products SET status = 'archived' WHERE store_id = ? AND id = ?");
      for (const e of deleted) if (e.subjectId) archive.run(storeId, tail(e.subjectId));
      if (catalog) archiveMissing(db, id, storeId, '[0-9]*', catalog.map((n) => tail(n.id)), today);
    });

    const ord = db.prepare(
      `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, supplier, tracking, cogs, local_date, tax) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
       ON CONFLICT (store_id, id) DO UPDATE SET total = excluded.total, status = excluded.status, fulfillment_status = excluded.fulfillment_status,
         tracking = coalesce(excluded.tracking, tracking), cogs = excluded.cogs, tax = excluded.tax`,
    );
    // Not paid yet (cash on delivery, bank transfer, an uncaptured authorization): left out of revenue until it is, and
    // removed if an earlier sync stored it. Its updated_at moves when it's paid, so the next sync brings it back.
    const UNPAID = new Set(['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID']);
    const dropItems = db.prepare('DELETE FROM order_items WHERE store_id = ? AND order_id = ?');
    const drop = db.prepare('DELETE FROM orders WHERE store_id = ? AND id = ?');
    let after: string | null = null;
    do {
      const page: { nodes: ShopifyOrder[]; pageInfo: PageInfo } = await q<{ orders: { nodes: ShopifyOrder[]; pageInfo: PageInfo } }>(ORDERS_Q, { after, q: filter }).then((d) => d.orders);
      for (const o of page.nodes.filter((o) => o.lineItems.pageInfo.hasNextPage)) {
        const rest = await all((after) => q<{ order: { lineItems: { nodes: LineItem[]; pageInfo: PageInfo } } }>(ORDER_ITEMS_Q, { id: o.id, after: after ?? o.lineItems.pageInfo.endCursor }).then((d) => d.order.lineItems));
        o.lineItems.nodes.push(...rest);
      }
      tx(db, () => {
        const days = new Set<string>();
        for (const o of page.nodes) {
          if (o.test) continue;
          const refunded = !!o.cancelledAt || ['REFUNDED', 'VOIDED', 'EXPIRED'].includes(o.displayFinancialStatus ?? '');
          const day = dayOf.format(new Date(o.createdAt));
          days.add(day);
          if (!refunded && UNPAID.has(o.displayFinancialStatus ?? '')) {
            dropItems.run(storeId, o.name);
            drop.run(storeId, o.name);
            continue;
          }
          const cogs = o.lineItems.nodes.reduce((a, li) => a + li.quantity * num(li.variant?.inventoryItem?.unitCost), 0);
          ord.run(storeId, o.name, o.createdAt, num(o.currentTotalPriceSet.shopMoney.amount), refunded ? 'refunded' : 'paid', fulfillmentOf(o), o.fulfillments[0]?.trackingInfo[0]?.number ?? null, Math.round(cogs * 100) / 100, day, num(o.currentTotalTaxSet?.shopMoney.amount));
          // Custom line items (no product) only count toward the order total. Where prices include VAT, each line gives up
          // the order's share of it. ponytail: one rate for all lines; reduced-rate lines come out a little low.
          const total = num(o.currentTotalPriceSet.shopMoney.amount);
          const net = o.taxesIncluded && total > 0 ? 1 - num(o.currentTotalTaxSet?.shopMoney.amount) / total : 1;
          setOrderItems(db, storeId, o.name, o.lineItems.nodes.flatMap((li) => (li.product ? [{ productId: tail(li.product.id), quantity: li.quantity, revenue: Math.round(num(li.discountedTotalSet.shopMoney.amount) * net * 100) / 100, cost: li.quantity * num(li.variant?.inventoryItem?.unitCost) }] : [])));
        }

        rebuildRevenue(db, storeId, days);
        const last = page.nodes.at(-1)?.updatedAt;
        if (last) db.prepare('UPDATE integrations SET cursor = ? WHERE id = ?').run(last < start ? last : start, id);
      });
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    // The funnel from Shopify's own analytics for a store without GA4 (GA4 owns it there). It needs read_reports and Level 2
    // customer data access, so without them orders sync on and the funnel stays empty. Bot visits (Shopify's human/bot
    // verdict, since October 2025) are read separately and taken off, so days it never classified keep their totals.
    if (!db.prepare('SELECT 1 FROM integrations WHERE id = ?').get(`ga4:${storeId}`)) {
      const query = (where: string) =>
        `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout${where} TIMESERIES day SINCE -${cursor ? 3 : BACKFILL_DAYS}d ORDER BY day ASC`;
      const read = (where: string) => q<{ shopifyqlQuery?: { tableData: Table } }>(FUNNEL_Q, { q: query(where) }).then((d) => d.shopifyqlQuery?.tableData ?? null, () => null);
      const table = await read('');
      const bots = new Map(funnelDays(table && (await read(" WHERE human_or_bot_session = 'bot'"))).map((d) => [d.date, d]));
      const up = db.prepare(
        `INSERT INTO daily_metrics (store_id, date, sessions, add_to_carts, checkouts) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id, date) DO UPDATE SET sessions = excluded.sessions, add_to_carts = excluded.add_to_carts, checkouts = excluded.checkouts`,
      );
      tx(db, () => {
        for (const d of funnelDays(table)) {
          const b = bots.get(d.date);
          up.run(storeId, d.date, Math.max(0, d.sessions - (b?.sessions ?? 0)), Math.max(0, d.carts - (b?.carts ?? 0)), Math.max(0, d.checkouts - (b?.checkouts ?? 0)));
        }
      });
    }
    db.prepare("UPDATE integrations SET cursor = ?, synced_at = ?, status = 'connected', error = NULL WHERE id = ?").run(start > since ? start : since, now.toISOString(), id);
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
function admin(db: Db, key: Buffer, storeId: string, fetchFn: Fetch) {
  const creds = getCredentials(db, key, 'shopify', storeId);
  if (!creds) throw new Error('Shopify is not connected for this store');
  return client(db, key, storeId, creds, fetchFn);
}

const check = (errors: { message: string }[]) => {
  if (errors.length) throw new Error(`Shopify: ${errors.map((e) => e.message).join('; ')}`);
};

/** Creates priced drafts one by one, each logged. A failure part-way names the drafts already created, so nobody adds them twice. */
export async function createProducts(db: Db, key: Buffer, storeId: string, products: NewProduct[], fetchFn: Fetch = fetch) {
  const q = admin(db, key, storeId, fetchFn);
  const insert = db.prepare(`INSERT OR IGNORE INTO products (store_id, id, title, image, price, compare_at, cost, inventory, status) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'draft')`);
  const created: { id: string; title: string }[] = [];
  for (const p of products) {
    try {
      const id = await logAction(db, storeId, 'product_create', p.title, { ...p }, async () => {
        type Created = { productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: { message: string }[] } };
        const { productCreate: c } = await q<Created>(CREATE_M, { product: { title: p.title, status: 'DRAFT' } });
        check(c.userErrors);
        const product = c.product!;
        const variant = { id: product.variants.nodes[0]!.id, price: p.price.toFixed(2), ...(p.compareAt ? { compareAtPrice: p.compareAt.toFixed(2) } : {}), ...(p.cost ? { inventoryItem: { cost: p.cost.toFixed(2) } } : {}) };
        const { productVariantsBulkUpdate: u } = await q<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(VARIANT_M, { productId: product.id, variants: [variant] });
        check(u.userErrors);
        return tail(product.id);
      });
      insert.run(storeId, id, p.title, p.price, p.compareAt ?? null, p.cost ?? 0);
      created.push({ id, title: p.title });
    } catch (e) {
      if (!created.length) throw e;
      throw new Error(`${(e as Error).message} (already created as drafts: ${created.map((c) => c.title).join(', ')})`);
    }
  }
  return created;
}

export interface ProductPage {
  title: string;
  descriptionHtml: string;
  seoTitle?: string;
  seoDescription?: string;
}

/** Replaces a live product's title, description and SEO. Call only for an approved request. */
export async function publishProductPage(db: Db, key: Buffer, storeId: string, productId: string, page: ProductPage, fetchFn: Fetch = fetch) {
  const seo = { ...(page.seoTitle ? { title: page.seoTitle } : {}), ...(page.seoDescription ? { description: page.seoDescription } : {}) };
  const product = { id: `gid://shopify/Product/${productId}`, title: page.title, descriptionHtml: page.descriptionHtml, ...(Object.keys(seo).length ? { seo } : {}) };
  await logAction(db, storeId, 'product_page_publish', productId, { title: page.title, ...(page.seoTitle ? { seoTitle: page.seoTitle } : {}) }, async () => {
    const { productUpdate: u } = await admin(db, key, storeId, fetchFn)<{ productUpdate: { userErrors: { message: string }[] } }>(PRODUCT_UPDATE_M, { product });
    check(u.userErrors);
  });
  db.prepare('UPDATE products SET title = ? WHERE store_id = ? AND id = ?').run(page.title, storeId, productId);
}

/**
 * Sets the price of every variant of a live product (compareAt: a number sets it, null clears it, omitted leaves it).
 * Call only for an approved request.
 */
export async function setProductPrice(db: Db, key: Buffer, storeId: string, productId: string, { price, compareAt }: { price: number; compareAt?: number | null }, fetchFn: Fetch = fetch) {
  if (!Number.isFinite(price) || price <= 0) throw new Error('Price must be more than 0');
  if (compareAt != null && !(Number.isFinite(compareAt) && compareAt > 0)) throw new Error('Compare-at price must be more than 0');
  await logAction(db, storeId, 'price_change', productId, { price, ...(compareAt !== undefined ? { compareAt } : {}) }, () => repriceVariants(admin(db, key, storeId, fetchFn), productId, price, compareAt));
  db.prepare('UPDATE products SET price = ?, compare_at = CASE WHEN ? THEN ? ELSE compare_at END WHERE store_id = ? AND id = ?').run(price, compareAt !== undefined ? 1 : 0, compareAt ?? null, storeId, productId);
}

async function repriceVariants(q: ReturnType<typeof admin>, productId: string, price: number, compareAt: number | null | undefined) {
  const productGid = `gid://shopify/Product/${productId}`;
  const { product } = await q<{ product: { variants: { nodes: { id: string; price: string }[]; pageInfo: { hasNextPage: boolean } } } | null }>(VARIANT_IDS_Q, { id: productGid });
  if (!product?.variants.nodes.length) throw new Error(`Shopify: product ${productId} not found`);
  if (product.variants.pageInfo.hasNextPage) throw new Error(`Shopify: product ${productId} has over 250 variants; change its price in Shopify`);
  // One price for all would flatten e.g. S $20 / XL $25.
  if (new Set(product.variants.nodes.map((v) => Number(v.price))).size > 1) throw new Error(`Shopify: product ${productId}'s variants have different prices; change them in Shopify`);
  const change = { price: price.toFixed(2), ...(compareAt !== undefined ? { compareAtPrice: compareAt === null ? null : compareAt.toFixed(2) } : {}) };
  const variants = product.variants.nodes.map((v) => ({ id: v.id, ...change }));
  const { productVariantsBulkUpdate: u } = await q<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(VARIANT_M, { productId: productGid, variants });
  check(u.userErrors);
}

/** Creates a published store page (about, FAQ, shipping, landing). Call only for an approved request. Returns its handle (/pages/<handle>). */
export async function publishPage(db: Db, key: Buffer, storeId: string, page: { title: string; bodyHtml: string }, fetchFn: Fetch = fetch) {
  type Created = { pageCreate: { page: { id: string; handle: string } | null; userErrors: { message: string }[] } };
  return logAction(db, storeId, 'page_publish', page.title, { title: page.title }, async () => {
    const { pageCreate: c } = await admin(db, key, storeId, fetchFn)<Created>(PAGE_CREATE_M, { page: { title: page.title, body: page.bodyHtml, isPublished: true } });
    check(c.userErrors);
    return { id: tail(c.page!.id), handle: c.page!.handle };
  });
}

const THEMES_Q = `{ themes(first: 50) { nodes { id name role processing } } }`;
const THEME_Q = `query ($id: ID!) { theme(id: $id) { id name role processing } }`;
const THEME_FILES_Q = `query ($id: ID!, $filenames: [String!]) {
  theme(id: $id) { files(filenames: $filenames, first: 250) { nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } } } } }`;
const THEME_DUPLICATE_M = `mutation ($id: ID!, $name: String) {
  themeDuplicate(id: $id, name: $name) { newTheme { id name role processing } userErrors { message } } }`;
const THEME_FILES_M = `mutation ($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) { upsertedThemeFiles { filename } userErrors { message } } }`;
const THEME_PUBLISH_M = `mutation ($id: ID!) { themePublish(id: $id) { theme { id name role processing } userErrors { message } } }`;
const THEME_DELETE_M = `mutation ($id: ID!) { themeDelete(id: $id) { deletedThemeId userErrors { message } } }`;

/** role MAIN is the live theme; a fresh copy is `processing` for a while before its files can be read or written. */
export interface ShopifyTheme {
  id: string;
  name: string;
  role: string;
  processing: boolean;
  /** Opens the storefront with this theme for whoever follows the link (the store's admin login isn't needed). */
  previewUrl: string;
}
type ThemeNode = Omit<ShopifyTheme, 'previewUrl'>;

const themeGid = (id: string) => `gid://shopify/OnlineStoreTheme/${id}`;

function themeApi(db: Db, key: Buffer, storeId: string, fetchFn: Fetch) {
  const q = admin(db, key, storeId, fetchFn);
  const host = shopHost(getCredentials(db, key, 'shopify', storeId)!.shopDomain!);
  const view = (t: ThemeNode): ShopifyTheme => ({ ...t, id: tail(t.id), previewUrl: `https://${host}/?preview_theme_id=${tail(t.id)}` });
  return { q, view };
}

export async function listThemes(db: Db, key: Buffer, storeId: string, fetchFn: Fetch = fetch): Promise<ShopifyTheme[]> {
  const { q, view } = themeApi(db, key, storeId, fetchFn);
  return (await q<{ themes: { nodes: ThemeNode[] } }>(THEMES_Q)).themes.nodes.map(view);
}

/** Theme files by name (`*` wildcards, 50 names at most). Binary files (images, fonts) come back with content null. */
export async function readThemeFiles(db: Db, key: Buffer, storeId: string, themeId: string, filenames: string[], fetchFn: Fetch = fetch) {
  if (!filenames.length || filenames.length > 50) throw new Error('Read 1 to 50 theme file names at a time');
  type Files = { theme: { files: { nodes: { filename: string; body: { content?: string } }[] } | null } | null };
  // ponytail: first 250 matches, no paging; a wildcard over a whole folder of a big theme can be cut short.
  const { theme } = await admin(db, key, storeId, fetchFn)<Files>(THEME_FILES_Q, { id: themeGid(themeId), filenames });
  if (!theme) throw new Error(`Shopify: theme ${themeId} not found`);
  return (theme.files?.nodes ?? []).map((f) => ({ filename: f.filename, content: f.body.content ?? null }));
}

/** Copies a theme as an unpublished draft to edit and preview; the live store doesn't change. */
export async function duplicateTheme(db: Db, key: Buffer, storeId: string, themeId: string, name: string, fetchFn: Fetch = fetch): Promise<ShopifyTheme> {
  const { q, view } = themeApi(db, key, storeId, fetchFn);
  return logAction(db, storeId, 'theme_duplicate', themeId, { name }, async () => {
    const { themeDuplicate: d } = await q<{ themeDuplicate: { newTheme: ThemeNode | null; userErrors: { message: string }[] } }>(THEME_DUPLICATE_M, { id: themeGid(themeId), name });
    check(d.userErrors);
    return view(d.newTheme!);
  });
}

/**
 * Writes text files (Liquid, JSON, CSS, JS) to an unpublished theme, 50 at most. The live theme is refused: edit a
 * copy (duplicateTheme), then publishTheme once the owner approves. Returns the filenames written.
 */
export async function upsertThemeFiles(db: Db, key: Buffer, storeId: string, themeId: string, files: { filename: string; body: string }[], fetchFn: Fetch = fetch) {
  if (!files.length || files.length > 50) throw new Error('Write 1 to 50 theme files at a time');
  const { q } = themeApi(db, key, storeId, fetchFn);
  const { theme } = await q<{ theme: ThemeNode | null }>(THEME_Q, { id: themeGid(themeId) });
  if (!theme) throw new Error(`Shopify: theme ${themeId} not found`);
  if (theme.role === 'MAIN') throw new Error(`"${theme.name}" is the live theme; edit a copy and publish it once approved`);
  return logAction(db, storeId, 'theme_files', themeId, { files: files.map((f) => f.filename) }, async () => {
    type Upserted = { themeFilesUpsert: { upsertedThemeFiles: { filename: string }[] | null; userErrors: { message: string }[] } };
    const { themeFilesUpsert: u } = await q<Upserted>(THEME_FILES_M, { themeId: themeGid(themeId), files: files.map((f) => ({ filename: f.filename, body: { type: 'TEXT', value: f.body } })) });
    check(u.userErrors);
    return (u.upsertedThemeFiles ?? []).map((f) => f.filename);
  });
}

/** Deletes an unpublished theme (e.g. a denied draft: a store keeps 20 themes at most). The live theme is refused. */
export async function deleteTheme(db: Db, key: Buffer, storeId: string, themeId: string, fetchFn: Fetch = fetch) {
  const { q } = themeApi(db, key, storeId, fetchFn);
  const { theme } = await q<{ theme: ThemeNode | null }>(THEME_Q, { id: themeGid(themeId) });
  if (!theme) throw new Error(`Shopify: theme ${themeId} not found`);
  if (theme.role === 'MAIN') throw new Error(`"${theme.name}" is the live theme; it can't be deleted`);
  await logAction(db, storeId, 'theme_delete', themeId, { name: theme.name }, async () => {
    const { themeDelete: d } = await q<{ themeDelete: { deletedThemeId: string | null; userErrors: { message: string }[] } }>(THEME_DELETE_M, { id: themeGid(themeId) });
    check(d.userErrors);
  });
}

/** Makes a theme the live one. Call only for an approved request. */
export async function publishTheme(db: Db, key: Buffer, storeId: string, themeId: string, fetchFn: Fetch = fetch): Promise<ShopifyTheme> {
  const { q, view } = themeApi(db, key, storeId, fetchFn);
  return logAction(db, storeId, 'theme_publish', themeId, {}, async () => {
    const { themePublish: p } = await q<{ themePublish: { theme: ThemeNode | null; userErrors: { message: string }[] } }>(THEME_PUBLISH_M, { id: themeGid(themeId) });
    check(p.userErrors);
    return view(p.theme!);
  });
}
