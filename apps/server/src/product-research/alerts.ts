import { createHash, randomUUID } from 'node:crypto';
import { PR_WATCH_PREFS, type PrAlertKind, type PrWatch, type PrWatchKind, type PrWatchPrefs, type Store } from '@frontline/shared';
import { tx, type Db } from '../db';
import { getCredentials } from '../integrations';
import { notify } from '../settings';
import { getStore } from '../stores';
import { refusal } from './caps';
import { refreshProduct } from './evaluate';
import { convertMinor, offerRows } from './facts';
import { current, fulfillmentOf, offerKey, type OfferRow } from './fulfillment';
import { minorDigits } from './money';
import { shipTo } from './profile';
import { REAL_REPORT } from './reports';
import { enrichCj } from './sources/cj';
import { setWatch } from './watches';

// Watchlists and alerts (PR-21): a scheduled check per watch, a live re-check within the watch cap where a source
// allows it, a comparison with the last check's result, and one alert per change (the dedupe key is the observation).

const DUE_MS = 12 * 3_600_000;
type Row = Record<string, unknown>;
type Deps = { now?: Date; fetchFn?: typeof fetch; gapMs?: number };

interface State {
  costShip: number | null;
  costObs: string | null;
  stock: number | null;
  stockObs: string | null;
  delivery: number | null;
  methods: string[];
  shipObs: string | null;
  evidence: number;
  products: string[];
}

/** What a watch follows: its product (or none for a niche), its offer series, its CJ listings and a label. */
function resolve(db: Db, w: Row) {
  const kind = String(w.target_kind) as PrWatchKind;
  const id = String(w.target_id);
  if (kind === 'niche') return { kind, productId: null, series: null, label: id };
  if (kind === 'offer') {
    const [listing] = id.split('|');
    const l = db.prepare('SELECT product_id, title FROM pr_listings WHERE id = ?').get(listing!);
    const [, , supplier, destination] = id.split('|');
    return { kind, productId: l ? String(l.product_id) : null, series: id, label: l ? `${supplier} · ${String(l.title)} → ${destination || '?'}` : 'An offer no longer listed' };
  }
  const productId = kind === 'listing' ? db.prepare('SELECT product_id FROM pr_listings WHERE id = ?').get(id)?.product_id : id;
  const p = productId ? db.prepare('SELECT title FROM pr_products WHERE id = ?').get(String(productId)) : undefined;
  return { kind, productId: productId ? String(productId) : null, series: null, label: p ? String(p.title) : 'A product no longer listed' };
}

const prefsOf = (w: Row): PrWatchPrefs => ({ ...PR_WATCH_PREFS, ...(JSON.parse(String(w.prefs_json ?? '{}')) as Partial<PrWatchPrefs>) });
const money = (m: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(m / 10 ** (minorDigits(currency) ?? 2));
const newest = (rows: OfferRow[]) => rows.map((o) => o.checkedAt).sort().at(-1) ?? null;

/** A niche is a product category (the Category filter's values), counted over the products this scope can see. */
const inNiche = (store: Store | null) => {
  const vis = store ? '(l.store_id IS NULL OR l.store_id = ?)' : 'l.store_id IS NULL';
  return `p.category = ? AND p.merged_into IS NULL AND EXISTS (SELECT 1 FROM pr_listings l WHERE l.product_id = p.id AND l.origin != 'legacy_sample' AND ${vis})`;
};

function stateOf(db: Db, t: ReturnType<typeof resolve>, store: Store | null, dest: string | null, currency: string, now: Date): State {
  const sp = store ? [store.id] : [];
  if (t.kind === 'niche') {
    const ids = db
      .prepare(`SELECT p.id FROM pr_products p WHERE ${inNiche(store)}`)
      .all(t.label, ...sp)
      .map((r) => String(r.id));
    return { costShip: null, costObs: null, stock: null, stockObs: null, delivery: null, methods: [], shipObs: null, evidence: 0, products: ids.sort() };
  }
  let rows = t.productId ? offerRows(db, t.productId, store?.id ?? null) : [];
  if (t.series) rows = rows.filter((o) => offerKey(o) === t.series);
  const cur = current(rows);
  const to = t.series ? t.series.split('|')[3] || null : dest;
  const f = to ? fulfillmentOf(rows, to, 1, now, (m, from) => convertMinor(db, m, from, currency)) : null;
  // Units per listing, variant and warehouse (one check repeats its stock on every method row).
  const units = new Map<string, number>();
  for (const o of cur) for (const s of o.stock ?? []) units.set(`${o.listingId}|${o.variantId}|${s.countryCode}`, Number(s.totalInventory ?? 0));
  const there = cur.filter((o) => o.destination === to);
  const days = there.map((o) => o.deliveryMax).filter((x): x is number => x !== null);
  const evidence = t.productId
    ? Number(
        db
          .prepare(
            `SELECT (SELECT count(*) FROM pr_signals WHERE (store_id IS NULL AND (product_id = ? OR id IN (SELECT signal_id FROM pr_signal_links WHERE product_id = ? AND confirmed_at IS NOT NULL)))
               ${store ? "OR (store_id = ? AND product_id = ? AND platform != 'tiktok_creative_center')" : ''})
             + ${store ? `(SELECT count(*) FROM pr_reports WHERE store_id = ? AND product_id = ? AND ${REAL_REPORT})` : '0'} AS n`,
          )
          .get(t.productId, t.productId, ...(store ? [store.id, t.productId, store.id, t.productId] : []))?.n ?? 0,
      )
    : 0;
  return {
    costShip: f?.costShip ?? null,
    costObs: f?.costShip == null ? null : (f.offer?.id ?? null),
    stock: units.size ? [...units.values()].reduce((a, b) => a + b, 0) : null,
    stockObs: newest(cur),
    delivery: days.length ? Math.min(...days) : null,
    methods: [...new Set(there.map((o) => o.method).filter((m): m is string => !!m))].sort(),
    shipObs: newest(there),
    evidence,
    products: [],
  };
}

/** The changes between two results the watch's preferences ask about, each with its dedupe key. */
export function changes(a: State, b: State, prefs: PrWatchPrefs, ctx: { currency: string; to: string | null; titles: (ids: string[]) => string[] }) {
  const out: { kind: PrAlertKind; title: string; body: string; key: string }[] = [];
  if (a.costShip !== null && b.costShip !== null && b.costShip !== a.costShip && b.costObs) {
    const pct = ((b.costShip - a.costShip) / a.costShip) * 100;
    if (Math.abs(pct) >= prefs.priceChangePct)
      out.push({ kind: 'price', title: `Cost + ship to ${ctx.to ?? '?'} ${pct > 0 ? 'up' : 'down'} ${Math.round(Math.abs(pct))}%`, body: `${money(a.costShip, ctx.currency)} → ${money(b.costShip, ctx.currency)}, excl. duties`, key: `price:${b.costObs}` });
  }
  if (prefs.stockOut && (a.stock ?? 0) > 0 && b.stock === 0 && b.stockObs) out.push({ kind: 'stock_out', title: 'Out of stock', body: 'No units at any warehouse in the latest check.', key: `stock_out:${b.stockObs}` });
  const methods = (m: string[]) => m.join(', ') || 'none';
  if (prefs.shippingChange && a.shipObs && b.shipObs && b.shipObs !== a.shipObs && (a.delivery !== b.delivery || methods(a.methods) !== methods(b.methods))) {
    const days = (d: number | null) => (d === null ? 'unknown' : `up to ${d} days`);
    out.push({ kind: 'shipping', title: `Shipping to ${ctx.to ?? '?'} changed`, body: `Delivery ${days(b.delivery)} (was ${days(a.delivery)}); methods ${methods(b.methods)} (were ${methods(a.methods)}).`, key: `shipping:${b.shipObs}` });
  }
  if (prefs.newEvidence && b.evidence > a.evidence) out.push({ kind: 'new_evidence', title: 'New evidence', body: `${b.evidence - a.evidence} new: a demand set or a report with measured evidence.`, key: `evidence:${b.evidence}` });
  const added = b.products.filter((p) => !a.products.includes(p));
  if (added.length) {
    const key = createHash('sha256').update(added.join(',')).digest('hex').slice(0, 16);
    out.push({ kind: 'new_products', title: `${added.length} new product${added.length === 1 ? '' : 's'}`, body: ctx.titles(added).slice(0, 3).join('; '), key: `new_products:${key}` });
  }
  return out;
}

/**
 * One watch's check. A CJ listing is re-checked live (purpose `watch`, within its daily cap) when CJ is connected; else
 * the comparison uses stored data and says so. The first check only records the result. An alert is stored once per
 * dedupe key and notified unless the owner turned research alerts off.
 */
export async function checkWatch(db: Db, key: Buffer, id: string, d: Deps = {}) {
  const now = d.now ?? new Date();
  const w = db.prepare('SELECT * FROM pr_watches WHERE id = ?').get(id);
  if (!w) return;
  const store = w.store_id ? (getStore(db, String(w.store_id)) ?? null) : null;
  const dest = store ? shipTo(db, store) : 'US'; // ponytail: the all-stores list checks the page's default ship-to
  const currency = store?.currency ?? 'USD';
  const t = resolve(db, w);
  let coverage: string | null = null;
  let error: string | null = null;
  const cj = t.productId && dest
    ? db
        .prepare(`SELECT id FROM pr_listings WHERE product_id = ? AND source = 'cj' AND status = 'active' AND ${store ? '(store_id IS NULL OR store_id = ?)' : 'store_id IS NULL'}`)
        .all(t.productId, ...(store ? [store.id] : []))
        .map((r) => String(r.id))
        .filter((l) => !t.series || t.series.startsWith(`${l}|`))
    : [];
  if (cj.length) {
    if (!getCredentials(db, key, 'cj')?.apiKey) coverage = "CJdropshipping isn't connected: compared with stored offers only";
    else
      for (const l of cj) {
        const refused = refusal(db, 'cj', 'watch', now);
        if (refused) {
          coverage = `${refused} Compared with stored offers only.`;
          break;
        }
        try {
          await enrichCj(db, key, l, dest!, { purpose: 'watch', now, ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}), ...(d.gapMs !== undefined ? { gapMs: d.gapMs } : {}) });
        } catch (e) {
          error = `CJdropshipping: ${e instanceof Error ? e.message : String(e)}`; // bounded: the next scheduled check tries again
          break;
        }
      }
    refreshProduct(db, t.productId!, now);
  } else if (t.kind !== 'niche') coverage = 'No source re-checks this live: compared with stored data only';
  const state = stateOf(db, t, store, dest, currency, now);
  const before = w.state_json ? (JSON.parse(String(w.state_json)) as State) : null;
  const titles = (ids: string[]) => ids.map((p) => String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(p)?.title ?? p));
  const found = before ? changes(before, state, prefsOf(w), { currency, to: t.series ? t.series.split('|')[3] || null : dest, titles }) : [];
  const link = t.kind === 'niche' ? `/research?store=${store?.id ?? 'all'}&view=new` : `/research?store=${store?.id ?? 'all'}&product=${t.productId ?? ''}`;
  const fresh = tx(db, () => {
    db.prepare('UPDATE pr_watches SET last_checked_at = ?, last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END, last_error = ?, state_json = ? WHERE id = ?').run(
      now.toISOString(), error, now.toISOString(), error, JSON.stringify({ ...state, coverage }), id,
    );
    return found.filter(
      (a) =>
        db.prepare('INSERT OR IGNORE INTO pr_alerts (id, watch_id, kind, title, body, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), id, a.kind, a.title, a.body, a.key, now.toISOString()).changes > 0,
    );
  });
  for (const a of fresh) notify(db, { kind: 'research_alert', title: `${t.label}: ${a.title}`, body: a.body, ...(store ? { storeId: store.id } : {}), link });
}

/** The jobs tick: every watch not checked in the last 12 hours, oldest first, at most 50 a tick. */
export async function watchPass(db: Db, key: Buffer, d: Deps = {}) {
  const now = d.now ?? new Date();
  const due = db.prepare('SELECT id FROM pr_watches WHERE last_checked_at IS NULL OR last_checked_at < ? ORDER BY last_checked_at LIMIT 50').all(new Date(now.getTime() - DUE_MS).toISOString());
  for (const r of due) await checkWatch(db, key, String(r.id), { ...d, now });
}

/** GET /api/pr/watches: a store's list and the owner's all-stores list (All stores: that list alone). */
export function listWatches(db: Db, store: Store | null): PrWatch[] {
  return db
    .prepare(`SELECT * FROM pr_watches WHERE ${store ? 'store_id = ? OR store_id IS NULL' : 'store_id IS NULL'} ORDER BY store_id IS NULL, created_at`)
    .all(...(store ? [store.id] : []))
    .map((w) => {
      const t = resolve(db, w);
      const state = w.state_json ? (JSON.parse(String(w.state_json)) as { coverage?: string | null }) : null;
      return {
        id: String(w.id),
        storeId: w.store_id == null ? null : String(w.store_id),
        kind: t.kind,
        targetId: String(w.target_id),
        label: t.label,
        productId: t.productId,
        prefs: prefsOf(w),
        lastCheckedAt: w.last_checked_at == null ? null : String(w.last_checked_at),
        lastSuccessAt: w.last_success_at == null ? null : String(w.last_success_at),
        lastError: w.last_error == null ? null : String(w.last_error),
        coverage: state?.coverage ?? null,
        alerts: db
          .prepare('SELECT id, kind, title, body, created_at FROM pr_alerts WHERE watch_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 5')
          .all(String(w.id))
          .map((a) => ({ id: String(a.id), kind: String(a.kind) as PrWatch['alerts'][number]['kind'], title: String(a.title), body: a.body == null ? null : String(a.body), createdAt: String(a.created_at) })),
      };
    });
}

/** A watch this scope may change: a store's own, or in All stores the owner's all-stores list. */
export const ownWatch = (db: Db, store: Store | null, id: string) =>
  db.prepare(`SELECT id FROM pr_watches WHERE id = ? AND ${store ? 'store_id = ?' : 'store_id IS NULL'}`).get(id, ...(store ? [store.id] : []));

/** POST /api/pr/watches: a niche (a category this scope can see) or an offer series (all-stores: shared rows only). */
export function addWatch(db: Db, store: Store | null, body: unknown): string | null {
  const b = (body ?? {}) as { kind?: unknown; targetId?: unknown };
  if (typeof b.targetId !== 'string' || !b.targetId || b.targetId.length > 500) return 'targetId is required';
  const vis = store ? '(l.store_id IS NULL OR l.store_id = ?)' : 'l.store_id IS NULL';
  const sp = store ? [store.id] : [];
  if (b.kind === 'niche') {
    if (!db.prepare(`SELECT 1 FROM pr_products p WHERE ${inNiche(store)} LIMIT 1`).get(b.targetId, ...sp)) return 'No product in that category here';
  } else if (b.kind === 'offer') {
    const [listing, variant, supplier, destination] = b.targetId.split('|');
    const found = db
      .prepare(`SELECT 1 FROM pr_offers o JOIN pr_listings l ON l.id = o.listing_id WHERE o.listing_id = ? AND ifnull(o.variant_id, '') = ? AND o.supplier = ? AND ifnull(o.destination, '') = ? AND ${vis} LIMIT 1`)
      .get(listing ?? '', variant ?? '', supplier ?? '', destination ?? '', ...sp);
    if (!found) return 'offer not found';
  } else return "kind must be niche or offer (a product is watched with its panel's Watch)";
  setWatch(db, { storeId: store?.id ?? null, kind: b.kind, targetId: b.targetId, on: true });
  return null;
}

/** PUT /api/pr/watches/:id: the owner's preferences, checked. */
export function parsePrefs(body: unknown): PrWatchPrefs | string {
  const p = ((body ?? {}) as { prefs?: unknown }).prefs as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return 'prefs is required';
  const out = { ...PR_WATCH_PREFS };
  for (const [k, v] of Object.entries(p)) {
    if (k === 'priceChangePct') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 100) return 'prefs.priceChangePct must be a percentage from 1 to 100';
      out.priceChangePct = v;
    } else if (k === 'stockOut' || k === 'newEvidence' || k === 'shippingChange') {
      if (typeof v !== 'boolean') return `prefs.${k} must be true or false`;
      out[k] = v;
    } else return `prefs.${k} is not a watch preference`;
  }
  return out;
}
