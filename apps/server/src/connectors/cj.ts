import type { FulfillmentStatus, PrErrorKind, SupplierProduct } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getCredentials, setIntegrationStatus, updateSecrets } from '../integrations';
import { recordCall, refusal, type CallPurpose } from '../product-research/caps';
import { SourceError } from '../product-research/sources/adapter';

// CJ Dropshipping API 2.0, read-only first: order status + tracking for orders the owner's stores sent to CJ, catalog search.
// One account serves every store (global integration). CJ allows one call per second on a free account.
const API = 'https://developers.cjdropshipping.com/api2.0/v1';
const ID = 'cj:global';
/** Orders paid in this window are still worth watching (CJ shipping takes 1–3 weeks). */
const WINDOW_DAYS = 30;
const STATUSES = ['UNSHIPPED', 'SHIPPED', 'DELIVERED'] as const;
const PAGE_SIZE = 20;

type Fetch = typeof fetch;
interface CjResponse<T> { code?: number; result?: boolean; message?: string; data: T; pointsInfo?: { usedToday?: number; remaining?: number; total?: number } }
interface CjOrder { orderNum: string | null; shopName: string | null; orderStatus: string; trackNumber: string | null }

const RANK: FulfillmentStatus[] = ['unfulfilled', 'fulfilled', 'in_transit', 'delivered'];
const CJ_STATUS: Record<string, FulfillmentStatus> = { SHIPPED: 'in_transit', DELIVERED: 'delivered' };

/** A refused CJ call with CJ's code; the message reads "CJ: <CJ's message>". */
export class CjError extends SourceError {
  constructor(kind: PrErrorKind, message: string, readonly code?: number, retryAfterMs?: number) {
    super(kind, `CJ: ${message}`, retryAfterMs);
  }
}

// CJ's error-code table (developers.cjdropshipping.com/en/api/api2/standard/ps-code.html, docs/features/product-research-sources.md).
const AUTH = [1600001, 1600002, 1600003, 1600004, 1600005, 1600006, 1600014, 1601000];
const NOT_FOUND = [1602000, 1602001, 1602003];
const REQUEST = [1600300, 1605002, 16900202, 16900205, 16900403];

export function classifyCj(status: number, code: number | undefined, message: string): PrErrorKind {
  if (status === 401 || status === 403 || (code !== undefined && AUTH.includes(code))) return 'auth';
  // The points page shows body code 429 "Insufficient API points…", the code table 16900500: both are the daily quota.
  if (code === 1600201 || code === 16900500 || /insufficient (api )?points/i.test(message)) return 'quota';
  if (status === 429 || code === 1600200 || code === 429) return 'rate_limit';
  if (code !== undefined && NOT_FOUND.includes(code)) return 'not_found';
  if (code !== undefined && REQUEST.includes(code)) return 'request';
  return 'server'; // 1600000 busy, 1600100 offline, 1600301 read timed out, 5xx, anything new
}

// One lane for every CJ call in the process, spaced for CJ's 1 request/second (free accounts). Waiting calls go by
// priority: order sync, then the owner's own actions, then ingestion and watch checks (decision 4).
const PRIORITY: Record<CallPurpose, number> = { order_sync: 3, owner: 2, search: 2, token: 2, ingestion: 1, watch: 1 };
const lane: { prio: number; go: () => void }[] = [];
let busyUntil = 0;
let pumping: ReturnType<typeof setTimeout> | undefined;
function pump(gapMs: number) {
  if (pumping) return;
  const wait = busyUntil - Date.now();
  if (wait > 0) {
    pumping = setTimeout(() => {
      pumping = undefined;
      pump(gapMs);
    }, wait);
    return;
  }
  lane.sort((a, b) => b.prio - a.prio); // stable: first come, first served within a priority
  const next = lane.shift();
  if (!next) return;
  busyUntil = Date.now() + gapMs;
  next.go();
  if (lane.length) pump(gapMs);
}
const turn = (purpose: CallPurpose, gapMs: number) => new Promise<void>((go) => (lane.push({ prio: PRIORITY[purpose], go }), pump(gapMs)));

export interface CjCtx { db: Db; fetchFn: Fetch; gapMs: number; purpose: CallPurpose; apiKey?: string }

/** CJ's answer (or a network error) may repeat the key or the token: neither reaches an error, a log or a row. */
const redact = (ctx: CjCtx, init: RequestInit, text: string) =>
  [ctx.apiKey?.trim(), (init.headers as Record<string, string> | undefined)?.['CJ-Access-Token']].reduce<string>((t, s) => (s ? t.split(s).join('[redacted]') : t), text);

/**
 * One CJ call: reserves its cap slot, waits its turn, times out after 60 s (the live check saw listV2 take 25 s), and
 * updates its pr_calls result. A successful envelope has data and no explicit failure. Existing 0/no-code response
 * compatibility is retained alongside documented code 200. Throws CjError with the failure's class.
 */
async function call<T>(ctx: CjCtx, path: string, init: RequestInit): Promise<T> {
  const refused = refusal(ctx.db, 'cj', ctx.purpose);
  if (refused) throw new CjError('quota', refused);
  const reserved = recordCall(ctx.db, 'cj', ctx.purpose, false).lastInsertRowid;
  await turn(ctx.purpose, ctx.gapMs);
  let res: Response;
  try {
    res = await ctx.fetchFn(`${API}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new CjError(timeout ? 'timeout' : 'server', timeout ? 'no answer within 60 s' : redact(ctx, init, e instanceof Error ? e.message : String(e)));
  }
  const parsed: unknown = await res.json().catch(() => undefined);
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<CjResponse<T>>;
  const ok = res.ok && body.result !== false && 'data' in body && (body.code === undefined || body.code === 200 || body.code === 0);
  ctx.db.prepare('UPDATE pr_calls SET ok = ? WHERE id = ?').run(ok ? 1 : 0, reserved);
  if (body.pointsInfo?.remaining !== undefined) {
    const at = new Date().toISOString();
    const quota = JSON.stringify({ pointsRemaining: body.pointsInfo.remaining, pointsTotal: body.pointsInfo.total ?? null, at });
    ctx.db.prepare(`INSERT INTO pr_sources (id, status, quota_json, updated_at) VALUES ('cj', 'ok', ?, ?) ON CONFLICT (id) DO UPDATE SET quota_json = excluded.quota_json`).run(quota, at);
  }
  if (!ok) {
    const message = redact(ctx, init, body.message ?? (res.ok ? 'Unsuccessful or invalid response' : `HTTP ${res.status}`));
    const after = Number(res.headers.get('retry-after'));
    throw new CjError(classifyCj(res.status, body.code, message), message, body.code, after > 0 ? Math.min(after, 600) * 1000 : undefined);
  }
  return body.data as T;
}

/** Cached access token, renewed from the API key a day before it expires (CJ hands out the same token for 24 h). */
async function accessToken(ctx: CjCtx, key: Buffer, creds: Record<string, string>, now: Date, force = false) {
  if (!force && creds.accessToken && Number(creds.accessTokenExpiresAt) * 1000 > now.getTime() + 86_400_000) return creds.accessToken;
  const t = await call<{ accessToken: string; accessTokenExpiryDate: string }>({ ...ctx, purpose: 'token' }, '/authentication/getAccessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: creds.apiKey!.trim() }),
  });
  const fresh = { accessToken: t.accessToken, accessTokenExpiresAt: String(Math.floor(Date.parse(t.accessTokenExpiryDate) / 1000)) };
  updateSecrets(ctx.db, key, ID, fresh);
  Object.assign(creds, fresh);
  return t.accessToken;
}

/** Runs `fn` with a token. A cached token CJ refuses (1600001) is replaced once, as CJ's development page recommends. */
async function withToken<T>(ctx: CjCtx, key: Buffer, creds: Record<string, string>, now: Date, fn: (token: string) => Promise<T>): Promise<T> {
  const cached = !!creds.accessToken;
  try {
    return await fn(await accessToken(ctx, key, creds, now));
  } catch (e) {
    if (!(cached && e instanceof CjError && e.code === 1600001)) throw e;
    return fn(await accessToken(ctx, key, creds, now, true));
  }
}

const utc = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

export async function syncCj(db: Db, key: Buffer, _storeId: string, fetchFn: Fetch = fetch, now = new Date(), gapMs = 1100) {
  const creds = getCredentials(db, key, 'cj');
  if (!creds) return;
  try {
    const ctx: CjCtx = { db, fetchFn, gapMs, purpose: 'order_sync', apiKey: creds.apiKey };
    const orders: CjOrder[] = [];
    // Only a real store's orders can match (demo stores are left out below). With none, checking the key is enough,
    // and its token is cached, so a sync every 10 minutes makes no call (decision 16 counts every CJ call).
    if (!db.prepare('SELECT 1 FROM stores WHERE demo = 0').get()) await accessToken(ctx, key, creds, now);
    else for (const status of STATUSES) {
      for (let page = 1; ; page++) {
        const q = new URLSearchParams({ pageNum: String(page), pageSize: String(PAGE_SIZE), status, paymentDateFrom: utc(new Date(now.getTime() - WINDOW_DAYS * 86_400_000)), paymentDateTo: utc(now) });
        const data = await withToken(ctx, key, creds, now, (token) => call<{ total: number; list: CjOrder[] | null }>(ctx, `/shopping/order/list?${q}`, { headers: { 'CJ-Access-Token': token } }));
        orders.push(...(data.list ?? []));
        if (!data.list?.length || page * PAGE_SIZE >= data.total) break;
      }
    }

    tx(db, () => {
      // CJ's order number is the store platform's: "#1001"/"1001" on Shopify, the TikTok Shop order id, the Etsy receipt id, the Woo order number.
      // Demo stores are left out: their sample orders count from #1001 too, and would make a real one ambiguous.
      const find = db.prepare(
        `SELECT o.store_id, o.id, o.fulfillment_status, lower(s.name) AS store FROM orders o JOIN stores s ON s.id = o.store_id
         WHERE o.id IN (?1, '#' || ?1, 'tt-' || ?1, 'etsy-' || ?1, 'woo-' || ?1) AND s.demo = 0`,
      );
      // Another parcel's number than the platform's drops the platform's carrier link (17track's is shown instead).
      const up = db.prepare(
        `UPDATE orders SET supplier = 'CJ Dropshipping', tracking_url = iif(?1 IS NULL OR ?1 IS tracking, tracking_url, NULL), tracking = coalesce(?1, tracking),
           fulfillment_status = ?2 WHERE store_id = ?3 AND id = ?4`,
      );
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

/** CJ catalog search by product name or SKU. Undefined when CJ isn't connected. Throws "CJ: <message>". */
export async function searchCj(db: Db, key: Buffer, q: string, limit: number, fetchFn: Fetch = fetch, now = new Date(), gapMs = 1100): Promise<SupplierProduct[] | undefined> {
  const creds = getCredentials(db, key, 'cj');
  if (!creds) return undefined;
  const ctx: CjCtx = { db, fetchFn, gapMs, purpose: 'search', apiKey: creds.apiKey };
  const params = new URLSearchParams({ keyWord: q, page: '1', size: String(Math.min(limit, 100)) }); // listV2 takes at most 100
  const data = await withToken(ctx, key, creds, now, (token) => call<{ content?: { productList?: CjProduct[] }[] }>(ctx, `/product/listV2?${params}`, { headers: { 'CJ-Access-Token': token } }));
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

// Product Research (decision 4): paged discovery, detail and variants, stock per warehouse and freight quotes. Field
// names are CJ's documented ones (docs/features/product-research-sources.md); every call is metered and classified.

/** A listV2 product as CJ sends it (only the fields Product Research reads). */
export interface CjListItem {
  id: string;
  nameEn: string;
  sku?: string;
  bigImage?: string;
  sellPrice?: string | number;
  listedNum?: number;
  categoryId?: string;
  oneCategoryName?: string;
  twoCategoryName?: string;
  threeCategoryName?: string;
  warehouseInventoryNum?: number;
  deliveryCycle?: string | number;
  supplierName?: string;
  directMinOrderNum?: number;
  createAt?: string | number;
}
export interface CjVariant {
  vid: string;
  variantNameEn?: string;
  variantSku?: string;
  barcode?: string;
  variantKey?: string;
  variantLength?: number;
  variantWidth?: number;
  variantHeight?: number;
  variantWeight?: number;
  variantSellPrice?: number | string;
}
export interface CjDetail { pid: string; productNameEn?: string; productSku?: string; productWeight?: number; categoryName?: string; entryCode?: string; variants?: CjVariant[] }
export interface CjStock { countryCode: string; totalInventory?: number; cjInventory?: number; factoryInventory?: number }
export interface CjFreight { logisticName: string; logisticPrice?: number | string; logisticAging?: string; totalPostageFee?: number | string }

export interface CjDeps { fetchFn?: Fetch; now?: Date; gapMs?: number; purpose: CallPurpose }

/** Calls CJ with the stored key. Throws CjError('auth') when CJ isn't connected, so a job stops instead of retrying. */
async function cj<T>(db: Db, key: Buffer, d: CjDeps, path: string, init: RequestInit = {}): Promise<T> {
  const creds = getCredentials(db, key, 'cj');
  if (!creds?.apiKey) throw new CjError('auth', 'not connected: enter the API key in Integrations');
  const ctx: CjCtx = { db, fetchFn: d.fetchFn ?? fetch, gapMs: d.gapMs ?? 1100, purpose: d.purpose, apiKey: creds.apiKey };
  return withToken(ctx, key, creds, d.now ?? new Date(), (token) => call<T>(ctx, path, { ...init, headers: { ...(init.headers as Record<string, string>), 'CJ-Access-Token': token } }));
}

/**
 * One page of CJ's catalog for a keyword or a category (`listV2`, at most 100 a page). `more` is false on the last page.
 * CJ sends the category names only when asked (`features=enable_category`).
 */
export async function cjListPage(db: Db, key: Buffer, q: ({ keyWord: string } | { categoryId: string }) & { page: number; size: number }, d: CjDeps) {
  const by: Record<string, string> = 'keyWord' in q ? { keyWord: q.keyWord } : { categoryId: q.categoryId };
  const size = Math.min(q.size, 100);
  const params = new URLSearchParams({ ...by, page: String(q.page), size: String(size), features: 'enable_category' });
  const data = await cj<{ totalRecords?: number; content?: { productList?: CjListItem[] }[] }>(db, key, d, `/product/listV2?${params}`);
  const items = (data.content ?? []).flatMap((c) => c.productList ?? []);
  return { items, total: Number(data.totalRecords ?? items.length), more: items.length > 0 && q.page * size < Number(data.totalRecords ?? 0) };
}

/** CJ's second-level categories (`getCategory`, one call for the whole tree), each with its "First > Second" path. */
export async function cjCategories(db: Db, key: Buffer, d: CjDeps) {
  type Tree = { categoryFirstName: string; categoryFirstList?: { categorySecondId: string; categorySecondName: string }[] }[];
  const tree = await cj<Tree>(db, key, d, '/product/getCategory');
  return tree.flatMap((f) => (f.categoryFirstList ?? []).map((s) => ({ id: String(s.categorySecondId), name: s.categorySecondName, path: `${f.categoryFirstName} > ${s.categorySecondName}` })));
}

export const cjProduct = (db: Db, key: Buffer, pid: string, d: CjDeps) => cj<CjDetail>(db, key, d, `/product/query?${new URLSearchParams({ pid })}`);

/** Stock for every variant of a product, per country of the warehouse. */
export async function cjInventory(db: Db, key: Buffer, pid: string, d: CjDeps) {
  const data = await cj<{ variantInventories?: { vid: string; inventory?: CjStock[] }[] }>(db, key, d, `/product/stock/getInventoryByPid?${new URLSearchParams({ pid })}`);
  return new Map((data.variantInventories ?? []).map((v) => [String(v.vid), v.inventory ?? []]));
}

/** Shipping methods, prices (USD) and CJ's delivery estimate for a variant and quantity, from one country to another. */
export const cjFreight = (db: Db, key: Buffer, q: { from: string; to: string; vid: string; quantity: number }, d: CjDeps) =>
  cj<CjFreight[]>(db, key, d, '/logistic/freightCalculate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ startCountryCode: q.from, endCountryCode: q.to, products: [{ quantity: q.quantity, vid: q.vid }] }),
  });

/** USD → cents. A missing, empty or unparseable price, or a range, is unknown: never 0 (decision 4). */
export function usdCents(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  if (typeof v !== 'string' || !/^\s*\d+(\.\d+)?\s*$/.test(v)) return null;
  return Math.round(Number(v) * 100);
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
