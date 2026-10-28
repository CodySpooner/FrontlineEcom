import { createHash, randomUUID } from 'node:crypto';
import type { PrFeedImport } from '@frontline/shared';
import { tx, type Db } from '../db';
import { upsertListing } from './catalog';
import { parseCsv } from './csv';
import { minorDigits, toMinor } from './money';

/** The supplier feed's columns (header names, any case). Only title, sku and currency are required. */
export const FEED_COLUMNS = [
  'title', 'sku', 'currency', 'product_ref', 'variant', 'unit_cost', 'shipping_cost', 'destination', 'delivery_days_min', 'delivery_days_max',
  'processing_days', 'stock', 'moq', 'ships_from', 'gtin', 'mpn', 'category', 'image_url', 'url', 'checked_at',
] as const;
type Col = (typeof FEED_COLUMNS)[number];
const REQUIRED: Col[] = ['title', 'sku', 'currency'];
const MAX_ROWS = 20_000;

interface Row { line: number; get: (c: Col) => string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'supplier';

/**
 * A CSV the owner is entitled to export from a supplier or a feed tool (decision 4, Authorized import): one listing per
 * product_ref (default: the sku), a variant per sku, an offer per row with origin `import`. An offer's checked_at is the
 * row's `checked_at`; a row without one is a `supplier_claim` dated at upload. Empty money or numbers are unknown, never
 * 0. Any bad cell refuses the whole file with its line, so nothing half-imports.
 */
export function importFeed(db: Db, input: { supplier: string; name: string; csv: string }, now = new Date()): PrFeedImport | { error: string } {
  const [header, ...rest] = parseCsv(input.csv);
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length) return { error: `The feed needs the columns ${missing.join(', ')}. Columns it reads: ${FEED_COLUMNS.join(', ')}.` };
  const rows: Row[] = rest
    .map((cells, i) => ({ line: i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim()))
    .map((r) => ({ line: r.line, get: (c: Col) => (r.cells[cols.indexOf(c)] ?? '').trim() }));
  if (!rows.length) return { error: 'The feed has no rows.' };
  if (rows.length > MAX_ROWS) return { error: `The feed has ${rows.length} rows; import at most ${MAX_ROWS} at a time.` };

  const errors: string[] = [];
  const at = now.toISOString();
  const parsed = rows.map((r) => {
    const bad = (c: Col, why: string) => (errors.push(`Line ${r.line}: ${c} "${r.get(c)}" ${why}.`), null);
    const currency = r.get('currency').toUpperCase();
    if (minorDigits(currency) === null) bad('currency', 'is not an ISO currency code');
    for (const c of REQUIRED) if (!r.get(c)) errors.push(`Line ${r.line}: ${c} is empty.`);
    const money = (c: Col) => {
      const v = toMinor(r.get(c), currency);
      return v === undefined ? (minorDigits(currency) === null ? null : bad(c, 'is not an amount like 3.42')) : v;
    };
    const int = (c: Col) => (r.get(c) === '' ? null : /^\d+$/.test(r.get(c)) ? Number(r.get(c)) : bad(c, 'is not a whole number'));
    const country = (c: Col) => (r.get(c) === '' ? null : /^[A-Za-z]{2}$/.test(r.get(c)) ? r.get(c).toUpperCase() : bad(c, 'is not a two-letter country code'));
    const link = (c: Col) => (r.get(c) === '' ? null : /^https?:\/\/\S+$/i.test(r.get(c)) && r.get(c).length <= 2048 ? r.get(c) : bad(c, 'is not an http(s) link'));
    const when = (d = r.get('checked_at')) => (d === '' ? null : Number.isFinite(Date.parse(d)) && Date.parse(d) <= now.getTime() + 86_400_000 ? new Date(Date.parse(d)).toISOString() : bad('checked_at', 'is not a past date'));
    return {
      ref: r.get('product_ref') || r.get('sku'), title: r.get('title'), sku: r.get('sku'), variant: r.get('variant') || null, currency,
      unit: money('unit_cost'), ship: money('shipping_cost'), destination: country('destination'), min: int('delivery_days_min'), max: int('delivery_days_max'),
      processing: int('processing_days'), stock: int('stock'), moq: int('moq'), from: country('ships_from'), gtin: r.get('gtin') || null, mpn: r.get('mpn') || null,
      category: r.get('category') || null, image: link('image_url'), url: link('url'), checked: when(),
    };
  });
  if (errors.length) return { error: errors.slice(0, 10).join(' ') + (errors.length > 10 ? ` …and ${errors.length - 10} more.` : '') };

  const sha = createHash('sha256').update(input.csv).digest('hex');
  const old = db.prepare(`SELECT id FROM pr_files WHERE kind = 'feed' AND sha256 = ?`).get(sha);
  if (old) return { fileId: String(old.id), duplicate: true, supplier: input.supplier, listings: 0, variants: 0, offers: 0, undated: 0 };
  const fileId = randomUUID();
  const source = `feed:${slug(input.supplier)}`;
  const listings = new Map<string, string>();
  const variants = new Set<string>();
  tx(db, () => {
    db.prepare(`INSERT INTO pr_files (id, kind, name, sha256, body, created_at) VALUES (?, 'feed', ?, ?, ?, ?)`).run(fileId, input.name, sha, input.csv, at);
    const variant = db.prepare(
      `INSERT INTO pr_variants (id, listing_id, source_ref, sku, gtin, mpn, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (listing_id, source_ref) DO UPDATE SET sku = excluded.sku, gtin = excluded.gtin, mpn = excluded.mpn, attributes_json = excluded.attributes_json`,
    );
    const offer = db.prepare(
      `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max,
         processing_days, moq, ships_from, stock_json, provenance, checked_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of parsed) {
      let listingId = listings.get(p.ref);
      if (!listingId) {
        listingId = upsertListing(db, { source, sourceRef: p.ref, origin: 'import', title: p.title, category: p.category, url: p.url, imageRef: p.image, currency: p.currency, retrievedAt: at, transform: { fileId, supplier: input.supplier }, at }).id;
        listings.set(p.ref, listingId);
      }
      variant.run(randomUUID(), listingId, p.sku, p.sku, p.gtin, p.mpn, JSON.stringify({ name: p.variant }));
      variants.add(`${listingId}|${p.sku}`);
      const variantId = String(db.prepare('SELECT id FROM pr_variants WHERE listing_id = ? AND source_ref = ?').get(listingId, p.sku)!.id);
      const stock = p.stock === null ? null : JSON.stringify([{ countryCode: p.from, totalInventory: p.stock }]);
      offer.run(randomUUID(), listingId, variantId, input.supplier, p.destination, p.unit, p.ship, p.currency, p.min, p.max, p.processing, p.moq, p.from, stock, p.checked ? 'import' : 'supplier_claim', p.checked ?? at);
    }
  });
  return { fileId, duplicate: false, supplier: input.supplier, listings: listings.size, variants: variants.size, offers: parsed.length, undated: parsed.filter((p) => !p.checked).length };
}
