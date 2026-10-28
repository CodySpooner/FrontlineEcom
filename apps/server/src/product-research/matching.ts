import { randomUUID } from 'node:crypto';
import type { PrFulfillment, PrMatch, PrMatchAction, PrMatches, PrMatchVerdict, Store } from '@frontline/shared';
import { CjError, cjListPage } from '../connectors/cj';
import { tx, type Db } from '../db';
import { getCredentials } from '../integrations';
import { CAPS } from './caps';
import { refreshProduct } from './evaluate';
import { shipTo } from './profile';
import { cjAdapter } from './sources/cj';

// Supplier matching and the "Already in your store" check (PR-20). Exact only on a shared SKU, GTIN or MPN, or the
// owner's word; everything else is Similar. A merge moves listings and keeps every one; Separate moves them back.

const STOP = new Set(['and', 'the', 'for', 'with', 'set', 'pcs', 'pack', 'new', 'from', 'size', 'free']);
/** A title's distinct words of 3+ characters, without filler. */
export const titleWords = (t: string) => [...new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => w.length >= 3 && !STOP.has(w));

export interface Ident {
  title: string;
  category: string | null;
  supplier: string;
  sku: string[];
  gtin: string[];
  mpn: string[];
  variants: string[];
}
export interface Judged {
  verdict: 'exact' | 'similar';
  matching: string[];
  differing: string[];
  shared: number;
}

/** The rule: a shared GTIN, MPN or SKU is Exact; anything else is Similar, with the fields that match and differ. */
export function judge(a: Ident, b: Ident): Judged {
  const matching: string[] = [];
  const differing: string[] = [];
  let exact = false;
  for (const [k, label] of [['gtin', 'GTIN'], ['mpn', 'MPN'], ['sku', 'SKU']] as const) {
    if (!a[k].length || !b[k].length) continue;
    const same = a[k].find((c) => b[k].includes(c));
    if (same) {
      exact = true;
      matching.push(`${label} ${same}`);
    } else differing.push(label);
  }
  const theirs = new Set(titleWords(b.title));
  const shared = titleWords(a.title).filter((w) => theirs.has(w));
  if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase()) matching.push('Title');
  else {
    if (shared.length) matching.push(`Title words: ${shared.join(', ')}`);
    differing.push('Title');
  }
  if (a.category && b.category) (a.category === b.category ? matching : differing).push('Category');
  const names = (v: string[]) => [...new Set(v.map((x) => x.toLowerCase()))].sort().join('|');
  if (a.variants.length && b.variants.length) (names(a.variants) === names(b.variants) ? matching : differing).push('Variants');
  (a.supplier === b.supplier ? matching : differing).push('Supplier');
  return { verdict: exact ? 'exact' : 'similar', matching, differing, shared: shared.length };
}

const LISTING = 'l.id, l.product_id, l.title, l.category, l.source, l.origin, l.transform_json, l.merged_from';
type Row = Record<string, unknown>;
const supplierOf = (l: Row) =>
  l.origin === 'owner_link'
    ? 'Your link'
    : l.origin === 'agent_find'
      ? 'Agent find'
      : l.source === 'cj'
        ? 'CJdropshipping'
        : ((JSON.parse(String(l.transform_json ?? '{}')) as { supplier?: string }).supplier ?? String(l.source));

function ident(db: Db, l: Row): Ident {
  const vs = db.prepare('SELECT sku, gtin, mpn, attributes_json FROM pr_variants WHERE listing_id = ?').all(String(l.id));
  const codes = (k: string) => [...new Set(vs.map((v) => String(v[k] ?? '').trim().toUpperCase()).filter(Boolean))];
  const variants = vs.map((v) => (JSON.parse(String(v.attributes_json ?? '{}')) as { name?: string }).name ?? '').filter(Boolean);
  return { title: String(l.title), category: l.category == null ? null : String(l.category), supplier: supplierOf(l), sku: codes('sku'), gtin: codes('gtin'), mpn: codes('mpn'), variants };
}

/** The product's listings this store can see, its own first (the panel names the first). */
const ownListings = (db: Db, storeId: string, productId: string) =>
  db.prepare(`SELECT ${LISTING} FROM pr_listings l WHERE l.product_id = ? AND l.origin != 'legacy_sample' AND (l.store_id IS NULL OR l.store_id = ?) ORDER BY l.store_id IS NOT NULL, l.first_seen_at`).all(productId, storeId);

/** The owner's verdicts on pairs with one of `own`, by the other listing. */
function ownerVerdicts(db: Db, own: string[]) {
  const q = own.map(() => '?').join(', ');
  const rows = own.length ? db.prepare(`SELECT listing_a, listing_b, verdict FROM pr_matches WHERE decided_by = 'owner' AND (listing_a IN (${q}) OR listing_b IN (${q}))`).all(...own, ...own) : [];
  return new Map(rows.map((r) => [String(own.includes(String(r.listing_a)) ? r.listing_b : r.listing_a), String(r.verdict) as PrMatchVerdict]));
}

const ORDER: Record<PrMatchVerdict, number> = { exact: 0, similar: 1, separate: 2 };

/** GET …/matches: other listings that may be this product, and the store's own products that may already be it. */
export function productMatches(db: Db, key: Buffer, store: Store, productId: string): PrMatches {
  const own = ownListings(db, store.id, productId);
  const mine = own.map((l) => ident(db, l));
  const words = [...new Set(mine.flatMap((m) => titleWords(m.title)))].slice(0, 8);
  const codes = [...new Set(mine.flatMap((m) => [...m.sku, ...m.gtin, ...m.mpn]))];
  const q = codes.map(() => '?').join(', ');
  const any = [...words.map(() => 'lower(l.title) LIKE ?'), ...(codes.length ? [`l.id IN (SELECT listing_id FROM pr_variants WHERE upper(sku) IN (${q}) OR upper(gtin) IN (${q}) OR upper(mpn) IN (${q}))`] : [])];
  // ponytail: a LIKE prefilter capped at 300 rows; a full-text index if catalogs outgrow it.
  const rows = any.length
    ? db
        .prepare(
          `SELECT ${LISTING} FROM pr_listings l JOIN pr_products p ON p.id = l.product_id
           WHERE l.product_id != ? AND p.merged_into IS NULL AND l.origin != 'legacy_sample' AND (l.store_id IS NULL OR l.store_id = ?) AND (${any.join(' OR ')}) LIMIT 300`,
        )
        .all(productId, store.id, ...words.map((w) => `%${w}%`), ...codes, ...codes, ...codes)
    : [];
  const owner = ownerVerdicts(db, own.map((l) => String(l.id)));
  const to = shipTo(db, store);
  const enough = Math.min(2, words.length);
  const candidates = rows
    .flatMap((r) => {
      const them = ident(db, r);
      const best = mine.map((m) => judge(m, them)).sort((x, y) => ORDER[x.verdict] - ORDER[y.verdict] || y.shared - x.shared)[0];
      const decided = owner.get(String(r.id));
      if (!best || (!decided && best.verdict !== 'exact' && best.shared < enough)) return [];
      const f = to ? db.prepare('SELECT cost_ship_minor, fulfillment_status FROM pr_product_facts WHERE product_id = ? AND destination = ? AND currency = ?').get(String(r.product_id), to, store.currency) : undefined;
      const m: PrMatch & { shared: number } = {
        listingId: String(r.id),
        productId: String(r.product_id),
        title: them.title,
        supplier: them.supplier,
        category: them.category,
        fixture: r.origin === 'fixture',
        verdict: decided ?? best.verdict,
        by: decided ? 'owner' : 'rule',
        matching: best.matching,
        differing: best.differing,
        costShip: f?.cost_ship_minor == null ? null : Number(f.cost_ship_minor),
        fulfillment: (f?.fulfillment_status ?? null) as PrFulfillment | null,
        shared: best.shared,
      };
      return [m];
    })
    .sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || b.shared - a.shared)
    .slice(0, 12)
    .map(({ shared: _, ...m }) => m);

  const outcomes = (kind: string) => new Set(db.prepare('SELECT ref_id FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind = ?').all(store.id, productId, kind).map((r) => String(r.ref_id)));
  const linked = outcomes('store_product');
  const ruledOut = outcomes('not_store_product');
  const mineWords = new Set(words);
  const inStore = db
    .prepare(`SELECT id, title FROM products WHERE store_id = ? AND (${['0', ...[...linked].map(() => 'id = ?'), ...words.map(() => 'lower(title) LIKE ?')].join(' OR ')}) LIMIT 300`)
    .all(store.id, ...linked, ...words.map((w) => `%${w}%`))
    .flatMap((p) => {
      const id = String(p.id);
      if (linked.has(id)) return [{ id, title: String(p.title), linked: true, matching: [] }];
      const shared = titleWords(String(p.title)).filter((w) => mineWords.has(w));
      return ruledOut.has(id) || !shared.length || shared.length < enough ? [] : [{ id, title: String(p.title), linked: false, matching: [`Title words: ${shared.join(', ')}`] }];
    })
    .sort((a, b) => Number(b.linked) - Number(a.linked) || b.matching.length - a.matching.length)
    .slice(0, 5);

  return {
    listings: own.map((l) => ({ id: String(l.id), title: String(l.title), supplier: supplierOf(l), mergedFrom: l.merged_from == null ? null : String(l.merged_from) })),
    candidates,
    inStore,
    cj: !!getCredentials(db, key, 'cj')?.apiKey,
  };
}

/** The owner's word on a candidate (same, not the same, undo), a merge of an exact match, or a split of a merged listing. */
export function decideMatch(db: Db, store: Store, productId: string, listingId: string, action: PrMatchAction, now = new Date()): { error: string; status: 404 | 409 } | null {
  const l = db.prepare(`SELECT ${LISTING} FROM pr_listings l WHERE l.id = ? AND l.origin != 'legacy_sample' AND (l.store_id IS NULL OR l.store_id = ?)`).get(listingId, store.id);
  if (!l) return { error: 'listing not found', status: 404 };
  const own = ownListings(db, store.id, productId);
  if (!own.length) return { error: 'product not found', status: 404 };
  const at = now.toISOString();
  const label = `"${String(l.title)}" (${supplierOf(l)})`;
  const history = (kind: 'merge' | 'separate', reason: string) =>
    db.prepare(`INSERT INTO pr_stage_history (id, store_id, product_id, kind, reason, by, at) VALUES (?, ?, ?, ?, ?, 'owner', ?)`).run(randomUUID(), store.id, productId, kind, reason, at);
  const verdict = (v: PrMatchVerdict | null, reason = '') => {
    const named = String(own[0]!.id);
    db.prepare('DELETE FROM pr_matches WHERE (listing_a = ? AND listing_b = ?) OR (listing_a = ? AND listing_b = ?)').run(named, listingId, listingId, named);
    if (!v) return;
    const j = judge(ident(db, own[0]!), ident(db, l));
    db.prepare(`INSERT INTO pr_matches (id, listing_a, listing_b, verdict, matching_json, differing_json, decided_by, reason, decided_at) VALUES (?, ?, ?, ?, ?, ?, 'owner', ?, ?)`)
      .run(randomUUID(), named, listingId, v, JSON.stringify(j.matching), JSON.stringify(j.differing), reason, at);
  };

  if (action === 'split') {
    const from = l.merged_from == null ? null : String(l.merged_from);
    if (String(l.product_id) !== productId || !from) return { error: 'Only a listing a merge brought in can be separated', status: 409 };
    tx(db, () => {
      db.prepare('UPDATE pr_listings SET product_id = ?, merged_from = NULL WHERE product_id = ? AND merged_from = ?').run(from, productId, from);
      db.prepare('UPDATE pr_products SET merged_into = NULL WHERE id = ?').run(from);
      verdict('separate', 'Separated after a merge');
      history('separate', `Separated ${label} back into its own product`);
    });
    refreshProduct(db, productId, now);
    refreshProduct(db, from, now);
    return null;
  }
  if (String(l.product_id) === productId) return { error: "That listing is this product's own", status: 409 };
  if (action === 'same') verdict('exact', 'The owner confirmed it is the same product');
  else if (action === 'not_same') tx(db, () => (verdict('separate', 'The owner said it is not the same product'), history('separate', `Not the same product as ${label}`)));
  else if (action === 'undo') verdict(null);
  else {
    const exact = ownerVerdicts(db, own.map((o) => String(o.id))).get(listingId) === 'exact' || own.some((o) => judge(ident(db, o), ident(db, l)).verdict === 'exact');
    if (!exact) return { error: 'Only an exact match can be merged: confirm it is the same product first', status: 409 };
    const from = String(l.product_id);
    if (db.prepare('SELECT 1 FROM pr_listings WHERE product_id = ? AND merged_from IS NOT NULL').get(from)) return { error: 'Separate the listings merged into that product first', status: 409 };
    tx(db, () => {
      db.prepare('UPDATE pr_listings SET product_id = ?, merged_from = ? WHERE product_id = ?').run(productId, from, from);
      db.prepare('UPDATE pr_products SET merged_into = ? WHERE id = ?').run(productId, from);
      verdict('exact', 'Merged by the owner');
      history('merge', `Merged ${label} into this product; every listing is kept`);
    });
    refreshProduct(db, productId, now);
  }
  return null;
}

/** "Search CJdropshipping": at most 3 catalog calls (the title's words, fewer words, a code), every result stored as a listing. */
export async function searchCjAlternatives(db: Db, key: Buffer, store: Store, productId: string, d: { fetchFn?: typeof fetch; gapMs?: number; now?: Date } = {}) {
  const now = d.now ?? new Date();
  const own = ownListings(db, store.id, productId).map((l) => ident(db, l));
  if (!own.length) return { calls: 0, stored: 0, error: 'product not found' };
  const words = titleWords(own[0]!.title);
  const code = own.flatMap((m) => [...m.gtin, ...m.mpn])[0];
  const queries = [...new Set([words.slice(0, 4).join(' '), words.slice(0, 2).join(' '), code ?? ''].filter(Boolean))].slice(0, CAPS.cj.altSupplierCallsPerSearch);
  const products = new Set<string>();
  let calls = 0;
  let error: string | undefined;
  for (const keyWord of queries) {
    try {
      const r = await cjListPage(db, key, { keyWord, page: 1, size: CAPS.cj.pageSize }, { purpose: 'owner', now, ...(d.fetchFn ? { fetchFn: d.fetchFn } : {}), ...(d.gapMs !== undefined ? { gapMs: d.gapMs } : {}) });
      calls++;
      for (const item of r.items) if (item.id && item.nameEn) products.add(cjAdapter.ingest!(db, item, now.toISOString()));
    } catch (e) {
      if (!(e instanceof CjError)) throw e;
      error = e.message; // no retry here: an auth, quota or server refusal stops the search
      break;
    }
  }
  products.forEach((p) => refreshProduct(db, p, now));
  return { calls, stored: products.size, ...(error ? { error } : {}) };
}
