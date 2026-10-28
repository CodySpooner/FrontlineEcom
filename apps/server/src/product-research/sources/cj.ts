import { createHash, randomUUID } from 'node:crypto';
import { cjCategories, CjError, cjFreight, cjInventory, cjListPage, cjProduct, usdCents, type CjDeps, type CjListItem, type CjStock } from '../../connectors/cj';
import { tx, type Db } from '../../db';
import { getCredentials } from '../../integrations';
import { log } from '../../log';
import { listStores } from '../../stores';
import { CAPS, refusal } from '../caps';
import { refreshProduct } from '../evaluate';
import { markSource } from '../jobs';
import { upsertListing } from '../catalog';
import { categoryMatches, discoveryQueries, NICHE_QUERIES, nicheWords, shipTo } from '../profile';
import type { PrAdapter } from './adapter';

const SUPPLIER = 'CJdropshipping';
/** A planned query for one of CJ's categories: `category:<id> <path>` (the path is for people reading the job). */
const CATEGORY = 'category:';
/** CJ's second-level categories as last fetched, in settings: `{ at, list: [{ id, name, path }] }`. */
const TREE = 'pr:cj:categories';
const WEEK = 7 * 86_400_000;

const cachedCategories = (db: Db): { id: string; name: string; path: string }[] =>
  (JSON.parse(String(db.prepare('SELECT value_json FROM settings WHERE key = ?').get(TREE)?.value_json ?? '{"list":[]}')) as { list: { id: string; name: string; path: string }[] }).list;

/** "2-5" → [2, 5], "7" → [7, 7]; anything else unknown. CJ's docs give no unit: shown as CJ's estimate. */
export function agingRange(v: unknown): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(String(v ?? ''));
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}

/** CJdropshipping as a discovery and fulfillment source (decision 4). Its listed counts are popularity among CJ sellers. */
export const cjAdapter: PrAdapter<CjListItem> = {
  id: 'cj',
  name: 'CJdropshipping',
  answers: ['discovery', 'fulfillment'],
  fields: ['title', 'image', 'category', 'list price (USD, supplier claim)', 'variants', 'stock per warehouse', 'shipping methods, prices and delivery estimates per destination', 'times listed by CJ sellers'],
  refreshHours: 24,
  rate: '1 request/second on a free account; 50,000 points a day (a catalog page 50, a detail, stock or freight call 10)',
  quota: `App limits: ${CAPS.cj.ingestionCallsPerDay} ingestion and ${CAPS.cj.watchCallsPerDay} watch calls a day, ${CAPS.cj.pagesPerQueryPerDay} pages of ${CAPS.cj.pageSize} per search a day`,
  connect: 'In CJ: Apps → install "API" (under Others) → My CJ → Authorization → API → Add API, Type API Key → copy it. Then Integrations → CJ Dropshipping → paste the API key.',
  access: (db) => (db.prepare(`SELECT 1 FROM pr_calls WHERE source = 'cj' AND ok = 1 LIMIT 1`).get() ? 'verified' : 'credentials_required'),
  ready: (db, key) => !!getCredentials(db, key, 'cj')?.apiKey,
  credentialsAt: (db) => db.prepare(`SELECT updated_at FROM integrations WHERE id = 'cj:global'`).get()?.updated_at as string | undefined,
  required: ['id', 'nameEn'],
  page: async ({ db, key, query, page, purpose }) => {
    const by = query.startsWith(CATEGORY) ? { categoryId: query.slice(CATEGORY.length).split(' ')[0]! } : { keyWord: query };
    const r = await cjListPage(db, key, { ...by, page, size: CAPS.cj.pageSize }, { purpose });
    return { items: r.items, more: r.more };
  },
  ingest: (db, item, at) =>
    upsertListing(db, {
      source: 'cj',
      sourceRef: String(item.id),
      origin: 'ingest',
      title: item.nameEn,
      category: item.threeCategoryName ?? item.twoCategoryName ?? item.oneCategoryName ?? null,
      imageRef: item.bigImage ?? null,
      currency: 'USD',
      retrievedAt: at,
      rawHash: createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16),
      // Kept as CJ said it: a list price is CJ's claim, the listed count is popularity among CJ sellers, never demand.
      transform: {
        spu: item.sku ?? null,
        listPriceUsd: item.sellPrice ?? null,
        listedNum: item.listedNum ?? null,
        categoryId: item.categoryId ?? null,
        warehouseInventoryNum: item.warehouseInventoryNum ?? null,
        deliveryCycle: item.deliveryCycle ?? null,
        supplierName: item.supplierName ?? null,
        moq: item.directMinOrderNum ?? null,
      },
      at,
    }).productId,
  // A store's niche is browsed as CJ's categories whose name has a niche word (CJ's keyword search returned nothing for
  // any keyword at the 2026-10-28 live check, even its documented "hoodie"); the owner's own keywords and categories stay
  // searches. Before the tree is fetched, the niche's phrases are searched. The catalog is shared, so a query two stores
  // share runs once. ponytail: niche words can catch a stray category (pet's "fish" takes Sports > Fishing).
  plan: (db) => {
    const tree = cachedCategories(db);
    const seen = new Set<string>();
    return listStores(db)
      .map((s) => {
        const cats = tree.filter((c) => categoryMatches(nicheWords(s), c.name)).map((c) => `${CATEGORY}${c.id} ${c.path}`);
        const phrases: string[] = s.niche === 'other' ? [s.nicheDetail?.trim().toLowerCase() ?? ''] : NICHE_QUERIES[s.niche];
        const queries = cats.length ? [...cats, ...discoveryQueries(db, s).filter((q) => !phrases.includes(q))] : discoveryQueries(db, s);
        return { storeId: s.id, queries: queries.filter((q) => !seen.has(q) && !!seen.add(q)) };
      })
      .filter((p) => p.queries.length > 0);
  },
  // One call a week at most: the tree changes rarely.
  prepare: async (db, key, now) => {
    const at = db.prepare(`SELECT json_extract(value_json, '$.at') AS at FROM settings WHERE key = ?`).get(TREE)?.at;
    if (at && now.getTime() - Date.parse(String(at)) < WEEK) return;
    const list = await cjCategories(db, key, { purpose: 'ingestion', now });
    db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(TREE, JSON.stringify({ at: now.toISOString(), list }));
  },
  enrich: (db, key) => enrichPass(db, key),
};

const inStock = (s: CjStock[]) => s.filter((w) => Number(w.totalInventory ?? 0) > 0);

/**
 * Enrich: one listing's variants, stock per warehouse and freight quotes to one destination, as `live` offer rows (a
 * new check adds rows; the latest per key is current). The cheapest variant with stock is quoted from at most two
 * warehouse countries (the destination's own first, then China). A product with no stock, or no method to the
 * destination, gets one row that says so: that's what makes it "Not eligible", never a silent gap.
 */
export async function enrichCj(db: Db, key: Buffer, listingId: string, destination: string, d: CjDeps) {
  const l = db.prepare(`SELECT source_ref, transform_json FROM pr_listings WHERE id = ? AND source = 'cj'`).get(listingId);
  if (!l) return;
  const pid = String(l.source_ref);
  const moq = (JSON.parse(String(l.transform_json ?? '{}')) as { moq?: number | null }).moq ?? null;
  const detail = await cjProduct(db, key, pid, d);
  const stock = await cjInventory(db, key, pid, d);
  const variants = tx(db, () =>
    (detail.variants ?? []).map((v) => {
      db.prepare(
        `INSERT INTO pr_variants (id, listing_id, source_ref, sku, gtin, attributes_json, weight_g, dimensions_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (listing_id, source_ref) DO UPDATE SET sku = excluded.sku, gtin = excluded.gtin, attributes_json = excluded.attributes_json, weight_g = excluded.weight_g, dimensions_json = excluded.dimensions_json`,
      ).run(
        randomUUID(),
        listingId,
        String(v.vid),
        v.variantSku ?? null,
        v.barcode || null,
        JSON.stringify({ name: v.variantNameEn ?? null, key: v.variantKey ?? null }),
        v.variantWeight ?? null,
        v.variantLength ? JSON.stringify({ lengthMm: v.variantLength, widthMm: v.variantWidth ?? null, heightMm: v.variantHeight ?? null }) : null,
      );
      const id = String(db.prepare('SELECT id FROM pr_variants WHERE listing_id = ? AND source_ref = ?').get(listingId, String(v.vid))!.id);
      return { id, vid: String(v.vid), cost: usdCents(v.variantSellPrice), stock: stock.get(String(v.vid)) ?? [] };
    }),
  );
  const offer = (o: { variantId: string | null; from: string | null; method: string | null; cost: number | null; ship: number | null; aging: [number, number] | null; stock: CjStock[]; restrictions: string | null }, at: string) =>
    db
      .prepare(
        `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, moq, ships_from, stock_json, restrictions, provenance, checked_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, 'live', ?)`,
      )
      .run(randomUUID(), listingId, o.variantId, SUPPLIER, destination, o.method, o.cost, o.ship, o.aging?.[0] ?? null, o.aging?.[1] ?? null, moq, o.from, JSON.stringify(o.stock), o.restrictions, at);
  const candidates = variants.filter((v) => inStock(v.stock).length && v.cost !== null).sort((a, b) => a.cost! - b.cost!);
  const pick = candidates[0];
  const at = (d.now ?? new Date()).toISOString();
  if (!pick) {
    offer({ variantId: variants[0]?.id ?? null, from: null, method: null, cost: variants[0]?.cost ?? null, ship: null, aging: null, stock: variants.flatMap((v) => v.stock), restrictions: variants.length ? 'Out of stock in every warehouse' : 'No variants listed' }, at);
    return;
  }
  const countries = [...new Set(inStock(pick.stock).map((w) => w.countryCode))].sort((a, b) => Number(b === destination) - Number(a === destination) || Number(b === 'CN') - Number(a === 'CN')).slice(0, 2);
  for (const from of countries) {
    const quotes = await cjFreight(db, key, { from, to: destination, vid: pick.vid, quantity: 1 }, d);
    tx(db, () => {
      if (!quotes.length) offer({ variantId: pick.id, from, method: null, cost: pick.cost, ship: null, aging: null, stock: pick.stock, restrictions: `No shipping method from ${from} to ${destination}` }, at);
      for (const q of quotes) offer({ variantId: pick.id, from, method: q.logisticName, cost: pick.cost, ship: usdCents(q.logisticPrice), aging: agingRange(q.logisticAging), stock: pick.stock, restrictions: null }, at);
    });
  }
}

/**
 * The daily enrichment pass: per store with a ship-to, up to 20 CJ listings with no offer to that destination checked
 * in the last 7 days, newest first. The daily cap, or a refused key or CJ's own quota, ends the pass (the last two stop
 * the source); a removed product is marked gone; any other failure skips that listing (the next pass tries again).
 */
export async function enrichPass(db: Db, key: Buffer, d: Omit<CjDeps, 'purpose'> = {}) {
  const now = d.now ?? new Date();
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  for (const store of listStores(db)) {
    const to = shipTo(db, store);
    if (!to) continue;
    const due = db
      .prepare(
        `SELECT l.id, l.product_id FROM pr_listings l WHERE l.source = 'cj' AND l.store_id IS NULL AND l.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM pr_offers o WHERE o.listing_id = l.id AND o.destination = ? AND o.checked_at >= ?)
         ORDER BY l.first_seen_at DESC LIMIT 20`,
      )
      .all(to, since);
    for (const r of due) {
      if (refusal(db, 'cj', 'ingestion', now)) return; // the app's own daily cap: try again tomorrow
      try {
        await enrichCj(db, key, String(r.id), to, { ...d, purpose: 'ingestion' });
        refreshProduct(db, String(r.product_id), now);
      } catch (e) {
        if (e instanceof CjError && e.kind === 'not_found') db.prepare(`UPDATE pr_listings SET status = 'gone' WHERE id = ?`).run(String(r.id));
        else if (e instanceof CjError && (e.kind === 'auth' || e.kind === 'quota')) return markSource(db, 'cj', { ok: false, kind: e.kind, error: e.message }, now);
        else log('error', 'CJ enrichment failed', { listing: String(r.id), error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}
