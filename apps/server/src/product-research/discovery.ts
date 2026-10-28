import { NICHES, PR_SORTS, PR_STAGES, PR_VIEWS, type Niche, type PrCard, type PrDiscovery, type PrFacet, type PrFit, type PrFlag, type PrFulfillment, type PrSort, type PrStage, type PrView, type Store } from '@frontline/shared';
import type { Db } from '../db';
import { getSettings } from '../settings';
import { evaluateStore } from './evaluate';
import { convertMinor, demandOf, factKeys, offerRows } from './facts';
import { flagsFor } from './flags';
import { fulfillmentOf } from './fulfillment';
import { NICHE_WORDS, shipTo as shipToOf } from './profile';

/** The filter chips (and "More filters") that can keep unknowns; `strict` lists the ones whose unknowns are dropped. */
export const LENIENT = ['category', 'warehouse', 'cost', 'delivery', 'evidence', 'niche', 'unit', 'ship'] as const;
export type Lenient = (typeof LENIENT)[number];

export interface DiscoveryFilters {
  category?: string[];
  source?: string[];
  warehouse?: string[];
  /** Minor units of the response currency. */
  costMax?: number;
  deliveryMax?: number;
  /** Evidence no older than this many days. */
  evidenceDays?: number;
  stage?: PrStage[];
  niche?: Exclude<Niche, 'other'>;
  supplier?: string[];
  unitMax?: number;
  shipMax?: number;
  fit?: PrFit[];
  flags?: 'any' | 'none';
  availability?: (PrFulfillment | 'unchecked')[];
}
export interface DiscoveryQuery {
  store: Store | null;
  /** One product only (the detail panel's card): facets are skipped. */
  id?: string;
  /** All stores only (store scope uses the profile's ship-to). */
  shipTo?: string;
  q?: string;
  view: PrView;
  sort: PrSort;
  cursor?: string;
  limit?: number;
  filters: DiscoveryFilters;
  strict: Lenient[];
}

const PAGE = 48;
const NEW_DAYS = 14;
const DAY = 86_400_000;
const SOURCE_LABEL: Record<string, string> = { cj: 'CJdropshipping', research_feed: 'Agent find' };
const marks = (n: number) => Array(n).fill('?').join(', ');

/** Decision 9's private evidence: the store's own orders sets with enough history (they never enter shared facts). */
export function privateDemand(db: Db, storeId: string): Map<string, ReturnType<typeof demandOf>> {
  const out = new Map<string, ReturnType<typeof demandOf>>();
  for (const s of db.prepare(`SELECT id, product_id, granularity FROM pr_signals WHERE store_id = ? AND platform = 'orders' AND product_id IS NOT NULL ORDER BY retrieved_at`).all(storeId)) {
    const d = demandOf(db, { id: String(s.id), granularity: s.granularity });
    if (d && d.cls !== 'insufficient_history') out.set(String(s.product_id), d);
  }
  return out;
}

/**
 * The discovery query (decision 14): every filter, sort and count in SQL over the scope's full matching set, from
 * `pr_product_facts` (one destination and currency) and the store's `pr_evaluations`, 48 cards a page.
 * ponytail: an offset cursor, so a page can repeat or skip a card while ingestion inserts; switch to a keyset cursor
 * over the sort keys if that shows.
 */
export function discover(db: Db, query: DiscoveryQuery, now = new Date()): PrDiscovery | { error: string } {
  const store = query.store;
  const base = getSettings(db).baseCurrency;
  const keys = factKeys(db);
  const currency = store?.currency ?? base;
  const shipTos = [...new Set(keys.filter(([to, cur]) => to && cur === currency).map(([to]) => to))];
  const shipTo = store ? shipToOf(db, store) : (query.shipTo ?? 'US');
  if (!store && !shipTos.includes(shipTo ?? '')) return { error: `Ship to one of ${shipTos.join(', ')}: costs and fulfillment are kept for those destinations.` };
  if (!store && (query.sort === 'best_fit' || query.filters.stage || query.filters.fit)) return { error: 'Store fit and stage are kept per store: pick a store.' };
  if (store && !db.prepare('SELECT 1 FROM pr_evaluations WHERE store_id = ? LIMIT 1').get(store.id)) evaluateStore(db, store, { rerank: true });

  const lenient = (k: Lenient) => (query.strict.includes(k) ? '0' : '1');
  const vis = (col: string) => (store ? `(${col} IS NULL OR ${col} = ?)` : '1');
  const visP = store ? [store.id] : [];
  const own = store ? privateDemand(db, store.id) : new Map<string, ReturnType<typeof demandOf>>();

  // FROM and the scope: products not merged away with a listing the scope may see that isn't a sample.
  const from = `FROM pr_products p
    LEFT JOIN pr_product_facts f ON f.product_id = p.id AND f.destination = ? AND f.currency = ?
    ${store ? 'LEFT JOIN pr_evaluations e ON e.product_id = p.id AND e.store_id = ?' : ''}`;
  const fromP: (string | number)[] = [shipTo ?? '', currency, ...visP];
  const scope = [`p.merged_into IS NULL`, `EXISTS (SELECT 1 FROM pr_listings l WHERE l.product_id = p.id AND l.origin != 'legacy_sample' AND ${vis('l.store_id')})`, ...(store ? ['(e.in_scope IS NULL OR e.in_scope = 1)'] : [])];
  const scopeP: (string | number)[] = [...visP];

  const where: string[] = [];
  const p: (string | number)[] = [];
  const f = query.filters;
  if (query.id) (where.push('p.id = ?'), p.push(query.id));
  const offerExists = (cond: string) =>
    `EXISTS (SELECT 1 FROM pr_offers o JOIN pr_listings l ON l.id = o.listing_id WHERE l.product_id = p.id AND l.origin != 'legacy_sample' AND ${vis('l.store_id')} AND ${vis('o.store_id')} AND ${cond})`;
  if (query.q?.trim()) {
    const like = `%${query.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(p.title LIKE ? ESCAPE '\\' OR p.category LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM pr_listings l LEFT JOIN pr_variants v ON v.listing_id = l.id
      WHERE l.product_id = p.id AND l.origin != 'legacy_sample' AND ${vis('l.store_id')} AND (l.title LIKE ? ESCAPE '\\' OR l.category LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\')))`);
    p.push(like, like, ...visP, like, like, like);
  }
  if (f.category?.length) (where.push(`(p.category IN (${marks(f.category.length)}) OR (p.category IS NULL AND ${lenient('category')}))`), p.push(...f.category));
  if (f.source?.length) (where.push(`EXISTS (SELECT 1 FROM pr_listings l WHERE l.product_id = p.id AND l.origin != 'legacy_sample' AND ${vis('l.store_id')} AND l.source IN (${marks(f.source.length)}))`), p.push(...visP, ...f.source));
  if (f.warehouse?.length) {
    where.push(`(${offerExists(`o.destination = ? AND o.ships_from IN (${marks(f.warehouse.length)})`)} OR (${lenient('warehouse')} AND NOT ${offerExists('o.destination = ? AND o.ships_from IS NOT NULL')}))`);
    p.push(...visP, ...visP, shipTo ?? '', ...f.warehouse, ...visP, ...visP, shipTo ?? '');
  }
  const max = (col: string, v: number | undefined, k: Lenient) => v !== undefined && (where.push(`(${col} <= ? OR (${col} IS NULL AND ${lenient(k)}))`), p.push(v));
  max('f.cost_ship_minor', f.costMax, 'cost');
  max('f.delivery_days', f.deliveryMax, 'delivery');
  max('f.unit_minor', f.unitMax, 'unit');
  max('f.ship_minor', f.shipMax, 'ship');
  if (f.evidenceDays !== undefined) (where.push(`(f.evidence_at >= ? OR (f.evidence_at IS NULL AND ${lenient('evidence')}))`), p.push(new Date(now.getTime() - f.evidenceDays * DAY).toISOString()));
  if (f.stage?.length) (where.push(`coalesce(e.stage, 'discovered') IN (${marks(f.stage.length)})`), p.push(...f.stage));
  if (f.fit?.length) (where.push(`coalesce(e.fit, 'unknown') IN (${marks(f.fit.length)})`), p.push(...f.fit));
  if (f.niche) {
    // ponytail: a word start after a space or the path's start; the evaluate step's regex is exact.
    const words = NICHE_WORDS[f.niche];
    where.push(`((${words.map(() => `(' ' || lower(p.category)) LIKE ?`).join(' OR ')}) OR (p.category IS NULL AND ${lenient('niche')}))`);
    p.push(...words.map((w) => `% ${w}%`));
  }
  if (f.supplier?.length) (where.push(offerExists(`o.supplier IN (${marks(f.supplier.length)})`)), p.push(...visP, ...visP, ...f.supplier));
  const flagged = store ? 'coalesce(e.open_flags, 0) > 0' : 'coalesce(f.rule_flags, 0) > 0';
  if (f.flags) where.push(f.flags === 'any' ? flagged : `NOT (${flagged})`);
  if (f.availability?.length) (where.push(`coalesce(f.fulfillment_status, 'unchecked') IN (${marks(f.availability.length)})`), p.push(...f.availability));

  // The view tabs, counted in one pass over the filtered set.
  const ownIds = JSON.stringify([...own.keys()]);
  const watchList = store ? 'w.store_id = ?' : 'w.store_id IS NULL';
  const VIEW: Record<PrView, { sql: string; params: (string | number)[] }> = {
    all: { sql: '1', params: [] },
    demand: { sql: `(coalesce(f.demand_sets, 0) > 0 OR p.id IN (SELECT value FROM json_each(?)))`, params: [ownIds] },
    new: { sql: 'f.first_seen_at >= ?', params: [new Date(now.getTime() - NEW_DAYS * DAY).toISOString()] },
    watchlist: {
      sql: `EXISTS (SELECT 1 FROM pr_watches w WHERE ${watchList} AND ((w.target_kind = 'product' AND w.target_id = p.id)
        OR (w.target_kind = 'listing' AND w.target_id IN (SELECT id FROM pr_listings WHERE product_id = p.id))))`,
      params: visP,
    },
    flagged: { sql: flagged, params: [] },
  };
  const all = [...scope, ...where].join(' AND ');
  const allP = [...fromP, ...scopeP, ...p];
  const views = Object.keys(VIEW) as PrView[];
  const c = db.prepare(`SELECT ${views.map((v) => `coalesce(sum(CASE WHEN ${VIEW[v].sql} THEN 1 ELSE 0 END), 0) AS "${v}"`).join(', ')} ${from} WHERE ${all}`).get(...views.flatMap((v) => VIEW[v].params), ...allP)!;
  const counts = Object.fromEntries(views.map((v) => [v, Number(c[v])])) as Record<PrView, number>;

  const month = now.getUTCMonth() + 1;
  const inSeason = `f.demand_peak_month IN (${month}, ${(month % 12) + 1})`;
  const ORDER: Record<PrSort, string> = {
    best_fit: `CASE e.fit WHEN 'strong' THEN 0 WHEN 'medium' THEN 1 WHEN 'weak' THEN 2 WHEN 'unknown' THEN 3 ELSE 4 END,
      CASE WHEN f.demand_class = 'sustained' THEN 0 WHEN f.demand_class = 'recent_acceleration' THEN 1 WHEN f.demand_class = 'seasonal' AND ${inSeason} THEN 2
        WHEN f.demand_class = 'isolated_spike' THEN 3 WHEN f.demand_class IN ('no_clear_pattern', 'seasonal') THEN 4 WHEN f.demand_class = 'insufficient_history' THEN 5 ELSE 6 END,
      f.cost_ship_minor IS NULL, f.cost_ship_minor`,
    recent: 'f.first_seen_at IS NULL, f.first_seen_at DESC',
    momentum: 'f.momentum IS NULL, f.momentum DESC',
    cost: 'f.cost_ship_minor IS NULL, f.cost_ship_minor',
  };
  const limit = Math.min(Math.max(query.limit ?? PAGE, 1), 100);
  const offset = Math.max(Number.parseInt(query.cursor ?? '0', 10) || 0, 0);
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.category, f.cost_ship_minor, f.cost_ship_offer_id, f.fulfillment_status, f.fulfillment_checked_at, f.demand_class,
         f.demand_peak_month, f.demand_set_id, f.demand_sets, f.first_seen_at, f.evidence_at, f.rule_flags
         ${store ? ', e.stage, e.fit, e.fit_reasons_json, e.flags_json, e.flag_dismissals_json' : ''}
       ${from} WHERE ${all} AND ${VIEW[query.view].sql} ORDER BY ${ORDER[query.sort]}, p.id LIMIT ? OFFSET ?`,
    )
    .all(...allP, ...VIEW[query.view].params, limit + 1, offset);
  const items = rows.slice(0, limit).map((r) => card(db, r, { store, shipTo, currency, own, now }));

  const facet = (sql: string, params: (string | number)[], label: (r: Record<string, unknown>) => string): PrFacet[] =>
    db.prepare(sql).all(...params).map((r) => ({ value: String(r.value ?? ''), label: label(r), n: Number(r.n) }));
  const inScope = `SELECT p.id ${from} WHERE ${scope.join(' AND ')}`;
  const scoped = [...fromP, ...scopeP];
  const listed = `JOIN pr_listings l ON l.product_id = s.id AND l.origin != 'legacy_sample' AND ${vis('l.store_id')}`;
  const offered = `${listed} JOIN pr_offers o ON o.listing_id = l.id AND ${vis('o.store_id')}`;
  const facets = query.id ? { categories: [], sources: [], warehouses: [], suppliers: [] } : {
    categories: facet(`SELECT p.category AS value, count(*) AS n FROM pr_products p WHERE p.id IN (${inScope}) GROUP BY p.category ORDER BY n DESC, value`, scoped, (r) => (r.value == null ? 'Category unknown' : String(r.value))),
    sources: facet(`SELECT l.source AS value, max(json_extract(l.transform_json, '$.supplier')) AS supplier, count(DISTINCT s.id) AS n FROM (${inScope}) s ${listed} GROUP BY l.source ORDER BY n DESC, value`, [...scoped, ...visP], (r) =>
      SOURCE_LABEL[String(r.value)] ?? (r.supplier ? String(r.supplier) : String(r.value))),
    warehouses: facet(`SELECT o.ships_from AS value, count(DISTINCT s.id) AS n FROM (${inScope}) s ${offered} WHERE o.destination = ? AND o.ships_from IS NOT NULL GROUP BY o.ships_from ORDER BY n DESC, value`, [...scoped, ...visP, ...visP, shipTo ?? ''], (r) => String(r.value)),
    suppliers: facet(`SELECT o.supplier AS value, count(DISTINCT s.id) AS n FROM (${inScope}) s ${offered} GROUP BY o.supplier ORDER BY n DESC, value`, [...scoped, ...visP, ...visP], (r) => String(r.value)),
  };
  const fx = db.prepare("SELECT json_extract(value_json, '$.date') AS d FROM settings WHERE key = 'fx'").get()?.d;
  return {
    items,
    next: rows.length > limit ? String(offset + limit) : null,
    total: counts[query.view],
    counts,
    facets,
    currency,
    shipTo: shipTo ?? null,
    shipTos: store ? (shipTo ? [shipTo] : []) : shipTos,
    fxDate: fx == null ? null : String(fx),
  };
}

const str = (v: unknown) => (v == null ? null : String(v));

const FITS: PrFit[] = ['strong', 'medium', 'weak', 'unknown'];
const AVAILABILITY = ['verified', 'pending', 'insufficient', 'not_eligible', 'unchecked'] as const;

/** `GET /api/pr/products`'s query string, validated: list filters repeat (`category=a&category=b`), money is minor units. */
export function parseDiscovery(q: Record<string, string[]>, store: Store | null): Omit<DiscoveryQuery, 'store'> | { error: string } {
  const one = (k: string) => q[k]?.at(-1);
  const list = (k: string) => (q[k] ?? []).map((v) => v.trim()).filter(Boolean);
  const pick = <T extends string>(k: string, allowed: readonly T[]): T[] | string => {
    const v = list(k);
    const bad = v.find((x) => !allowed.includes(x as T));
    return bad === undefined ? (v as T[]) : `${k} must be one of ${allowed.join(', ')}`;
  };
  const whole = (k: string): number | undefined | string => {
    const v = one(k);
    if (v === undefined || v === '') return undefined;
    return /^\d{1,10}$/.test(v) ? Number(v) : `${k} must be a whole number${k.endsWith('Max') && k !== 'deliveryMax' ? ' in minor units (cents)' : ''}`;
  };
  const view = (one('view') ?? 'all') as PrView;
  if (!PR_VIEWS.includes(view)) return { error: `view must be one of ${PR_VIEWS.join(', ')}` };
  const sort = (one('sort') ?? (store ? 'best_fit' : 'recent')) as PrSort;
  if (!PR_SORTS.includes(sort)) return { error: `sort must be one of ${PR_SORTS.join(', ')}` };
  const search = one('q');
  if (search && search.length > 200) return { error: 'q is at most 200 characters' };
  const ship = one('shipTo')?.toUpperCase();
  if (ship !== undefined && !/^[A-Z]{2}$/.test(ship)) return { error: 'shipTo must be a two-letter country code' };
  const cursor = one('cursor');
  if (cursor !== undefined && !/^\d{1,9}$/.test(cursor)) return { error: 'cursor must be the `next` value of the previous page' };
  const limit = whole('limit');
  if (typeof limit === 'string' || (limit !== undefined && (limit < 1 || limit > 100))) return { error: 'limit must be 1–100' };
  const niche = one('niche');
  if (niche !== undefined && (niche === 'other' || !NICHES.includes(niche as Niche))) return { error: `niche must be one of ${NICHES.filter((n) => n !== 'other').join(', ')}` };
  const flags = one('flags');
  if (flags !== undefined && flags !== 'any' && flags !== 'none') return { error: 'flags must be any or none' };
  const strict = (one('strict') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (strict.some((s) => !LENIENT.includes(s as Lenient))) return { error: `strict lists filters whose unknowns are dropped: ${LENIENT.join(', ')}` };
  const stage = pick('stage', PR_STAGES);
  const fit = pick('fit', FITS);
  const availability = pick('availability', AVAILABILITY);
  for (const v of [stage, fit, availability]) if (typeof v === 'string') return { error: v };
  const filters: DiscoveryFilters = {};
  for (const k of ['costMax', 'deliveryMax', 'evidenceDays', 'unitMax', 'shipMax'] as const) {
    const v = whole(k);
    if (typeof v === 'string') return { error: v };
    if (v !== undefined) filters[k] = v;
  }
  for (const k of ['category', 'source', 'supplier'] as const) if (list(k).length) filters[k] = list(k);
  if (list('warehouse').length) filters.warehouse = list('warehouse').map((w) => w.toUpperCase());
  if ((stage as PrStage[]).length) filters.stage = stage as PrStage[];
  if ((fit as PrFit[]).length) filters.fit = fit as PrFit[];
  if ((availability as DiscoveryFilters['availability'])!.length) filters.availability = availability as DiscoveryFilters['availability'];
  if (niche) filters.niche = niche as DiscoveryFilters['niche'];
  if (flags) filters.flags = flags;
  return {
    view,
    sort,
    filters,
    strict: strict as Lenient[],
    ...(search?.trim() ? { q: search.trim() } : {}),
    ...(ship ? { shipTo: ship } : {}),
    ...(cursor ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** A card from its query row, plus what the page shows that no filter needs: the listing it names, conditions, demand line. */
function card(db: Db, r: Record<string, unknown>, ctx: { store: Store | null; shipTo: string | null; currency: string; own: Map<string, ReturnType<typeof demandOf>>; now: Date }): PrCard {
  const id = String(r.id);
  const { store } = ctx;
  const l = db
    .prepare(
      `SELECT source, origin, url, store_id, transform_json FROM pr_listings WHERE product_id = ? AND origin != 'legacy_sample' ${store ? 'AND (store_id IS NULL OR store_id = ?)' : ''}
       ORDER BY store_id IS NOT NULL, first_seen_at LIMIT 1`,
    )
    .get(id, ...(store ? [store.id] : []))!;
  const origin = String(l.origin) as PrCard['source']['origin'];
  const host = l.url ? (URL.canParse(String(l.url)) ? new URL(String(l.url)).host : null) : null;
  const supplier = (JSON.parse(String(l.transform_json ?? '{}')) as { supplier?: string }).supplier;
  const label = origin === 'owner_link' ? 'Your link' : origin === 'agent_find' ? 'Agent find' : (SOURCE_LABEL[String(l.source)] ?? supplier ?? String(l.source));

  // The row the status is shown with: Rank's own rule on the same offers (the facts row keeps only the cost row).
  const shown = ctx.shipTo && r.fulfillment_status ? fulfillmentOf(offerRows(db, id, store?.id ?? null), ctx.shipTo, 1, ctx.now, (m, from) => convertMinor(db, m, from, ctx.currency)) : null;
  const o = shown?.offer ?? null;
  const variant = o?.variantId ? str(JSON.parse(String(db.prepare('SELECT attributes_json FROM pr_variants WHERE id = ?').get(o.variantId)?.attributes_json ?? '{}')).name) : null;

  const set = r.demand_set_id ? db.prepare('SELECT platform, query, region, period_start, period_end, scope FROM pr_signals WHERE id = ?').get(String(r.demand_set_id)) : undefined;
  const mine = ctx.own.get(id);
  const ownSet = mine && !set ? db.prepare(`SELECT platform, query, region, period_start, period_end, scope FROM pr_signals WHERE store_id = ? AND product_id = ? AND platform = 'orders'`).get(store!.id, id) : undefined;
  const ds = set ?? ownSet;
  const cls = set ? str(r.demand_class) : mine ? mine.cls : null;

  let flags: PrCard['flags'] = null;
  if (store && r.flags_json != null) {
    const dismissed = JSON.parse(String(r.flag_dismissals_json ?? '{}')) as Record<string, unknown>;
    const open = (JSON.parse(String(r.flags_json)) as PrFlag[]).filter((x) => !dismissed[x.id]);
    flags = { count: open.length, first: open[0] ?? null };
  } else if (!store && r.rule_flags != null) {
    const all = flagsFor({ title: String(r.title), category: str(r.category) });
    flags = { count: all.length, first: all[0] ?? null };
  }
  return {
    id,
    title: String(r.title),
    imageListing: str(
      db
        .prepare(`SELECT id FROM pr_listings WHERE product_id = ? AND image_ref IS NOT NULL AND origin != 'legacy_sample' ${store ? 'AND (store_id IS NULL OR store_id = ?)' : ''} ORDER BY store_id IS NOT NULL, first_seen_at LIMIT 1`)
        .get(id, ...(store ? [store.id] : []))?.id,
    ),
    category: str(r.category),
    source: { id: String(l.source), label, host: origin === 'owner_link' || origin === 'agent_find' ? host : null, origin },
    fixture: origin === 'fixture',
    privateTo: str(l.store_id),
    stage: store ? ((str(r.stage) ?? 'discovered') as PrStage) : null,
    watched: !!db
      .prepare(`SELECT 1 FROM pr_watches w WHERE ${store ? 'w.store_id = ?' : 'w.store_id IS NULL'} AND ((w.target_kind = 'product' AND w.target_id = ?) OR (w.target_kind = 'listing' AND w.target_id IN (SELECT id FROM pr_listings WHERE product_id = ?)))`)
      .get(...(store ? [store.id] : []), id, id),
    costShip: r.cost_ship_minor == null ? null : Number(r.cost_ship_minor),
    fulfillment: r.fulfillment_status ? { status: String(r.fulfillment_status) as PrFulfillment, reasons: shown?.reasons ?? [], checkedAt: str(r.fulfillment_checked_at) } : null,
    conditions: o ? { variant, method: o.method, quantity: o.quantity, checkedAt: o.checkedAt } : null,
    demand: cls && ds
      ? { cls: cls as NonNullable<PrCard['demand']>['cls'], peakMonth: set ? (r.demand_peak_month == null ? null : Number(r.demand_peak_month)) : (mine?.peakMonth ?? null), platform: String(ds.platform), query: str(ds.query), region: str(ds.region), periodStart: str(ds.period_start), periodEnd: str(ds.period_end), scope: String(ds.scope) as NonNullable<PrCard['demand']>['scope'] }
      : null,
    demandSets: Number(r.demand_sets ?? 0) + (mine ? 1 : 0),
    fit: store && r.fit ? { fit: String(r.fit) as PrFit, reason: (JSON.parse(String(r.fit_reasons_json ?? '[]')) as string[])[0] ?? '' } : null,
    flags,
    storesEvaluating: store ? 0 : Number(db.prepare('SELECT count(DISTINCT store_id) AS n FROM pr_stage_history WHERE product_id = ?').get(id)?.n ?? 0),
    firstSeenAt: str(r.first_seen_at),
    evidenceAt: str(r.evidence_at),
  };
}
