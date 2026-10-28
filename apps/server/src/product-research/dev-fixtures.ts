import { randomUUID } from 'node:crypto';
import { tx, type Db } from '../db';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';

// Dev-only test data for screenshots and scale checks (decision 14). Every row is origin or provenance `fixture`: the
// card and panel show "Test fixture", the source strip says "test fixtures (not connected)", a fixture offer never
// verifies fulfillment and a fixture set never qualifies as demand evidence. Only `dev-fixtures-cli.ts` calls this,
// and only against this worktree's own data dir. The names are generic test products, not the design board's.

const BASE: { title: string; category: string; unit: number | null; ship: number | null; from: string; stock: number; days: number; trend?: 'flat' | 'rising' | 'seasonal' | 'sparse' }[] = [
  { title: 'silicone grooming brush', category: 'Pet Supplies > Grooming', unit: 342, ship: 410, from: 'CN', stock: 1200, days: 12, trend: 'flat' },
  { title: 'slow feeder mat', category: 'Pet Supplies > Feeding', unit: 198, ship: 240, from: 'CN', stock: 800, days: 14, trend: 'seasonal' },
  { title: 'rechargeable nail trimmer', category: 'Pet Supplies > Grooming', unit: 625, ship: 600, from: 'US', stock: 40, days: 6, trend: 'rising' },
  { title: 'lint roller refill set', category: 'Home > Cleaning', unit: 150, ship: null, from: 'CN', stock: 3000, days: 15 },
  { title: 'window perch for cats', category: 'Pet Supplies > Cat Furniture', unit: 890, ship: 360, from: 'CN', stock: 0, days: 18, trend: 'seasonal' },
  { title: 'collar tracker holder compatible with AirTag', category: 'Pet Supplies > Walking', unit: 120, ship: 238, from: 'CN', stock: 500, days: 11, trend: 'flat' },
  { title: 'collapsible travel bowl', category: 'Pet Supplies > Walking', unit: 148, ship: 238, from: 'CN', stock: 2400, days: 11, trend: 'sparse' },
  { title: 'reflective leash with a very long product title that keeps going to test the two-line clamp on cards', category: 'Pet Supplies > Walking', unit: 260, ship: 310, from: 'CN', stock: 75, days: 13 },
  { title: 'kitchen spatula set', category: 'Home > Kitchen', unit: 210, ship: 330, from: 'CN', stock: 900, days: 16 },
  { title: 'unknown-category chew toy', category: '', unit: null, ship: null, from: 'CN', stock: 0, days: 0 },
];

/** Weekly points for 104 weeks ending last Sunday, shaped like each demand class (fixture shapes, not observations). */
function points(shape: NonNullable<(typeof BASE)[number]['trend']>, now: Date) {
  const sunday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay() - 7));
  return Array.from({ length: shape === 'sparse' ? 10 : 104 }, (_, i) => {
    const at = new Date(sunday.getTime() - (103 - i) * 7 * 86_400_000);
    const v = shape === 'flat' ? 50 + (i % 3) : shape === 'rising' ? (i < 78 ? 30 : 60) : shape === 'seasonal' ? (at.getUTCMonth() === 11 ? 100 : 30) : 10;
    return { at: at.toISOString().slice(0, 10), value: v };
  });
}

/** Writes the fixture catalog (and `scale` more generated products) and runs Rank and Evaluate on it. Re-running updates. */
export function loadFixtures(db: Db, { scale = 0, now = new Date(), log = (_: string) => {} } = {}) {
  const rows: (typeof BASE)[number][] = [
    ...BASE,
    ...Array.from({ length: scale }, (_, i) => ({
      title: `Generated product ${i + 1}`,
      category: ['Pet Supplies > Grooming', 'Pet Supplies > Toys', 'Home > Kitchen', 'Home > Cleaning', ''][i % 5]!,
      unit: i % 6 === 0 ? null : 100 + ((i * 7919) % 1500),
      ship: i % 9 === 0 ? null : 150 + ((i * 104729) % 700),
      from: i % 4 === 0 ? 'US' : 'CN',
      stock: i % 11 === 0 ? 0 : 10 + (i % 500),
      days: 6 + (i % 14),
    })),
  ];
  const ids = tx(db, () =>
    rows.map((r, i) => {
      const seen = new Date(now.getTime() - (i % 30) * 86_400_000).toISOString();
      const { id: listingId, productId } = upsertListing(db, { source: 'cj', sourceRef: `fixture-${i}`, origin: 'fixture', title: r.title, category: r.category || null, at: seen, retrievedAt: seen });
      db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, sku, attributes_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT (listing_id, source_ref) DO NOTHING`).run(randomUUID(), listingId, `fixture-${i}-v`, `FIX-${i}`, JSON.stringify({ name: 'Test variant' }));
      const variant = String(db.prepare('SELECT id FROM pr_variants WHERE listing_id = ? AND source_ref = ?').get(listingId, `fixture-${i}-v`)!.id);
      db.prepare('DELETE FROM pr_offers WHERE listing_id = ?').run(listingId);
      if (r.days)
        db.prepare(
          `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, ships_from, stock_json, provenance, checked_at)
           VALUES (?, ?, ?, 'CJdropshipping', 'US', 1, 'Test method', ?, ?, 'USD', ?, ?, ?, ?, 'fixture', ?)`,
        ).run(randomUUID(), listingId, variant, r.unit, r.ship, Math.max(1, r.days - 4), r.days, r.from, JSON.stringify([{ countryCode: r.from, totalInventory: r.stock }]), seen);
      if (r.trend && !db.prepare(`SELECT 1 FROM pr_signals WHERE product_id = ? AND origin = 'fixture'`).get(productId)) {
        const sid = randomUUID();
        const pts = points(r.trend, now);
        db.prepare(
          `INSERT INTO pr_signals (id, product_id, platform, query, region, period_start, period_end, granularity, metric, scope, origin, retrieved_at)
           VALUES (?, ?, 'google_trends', ?, 'US', ?, ?, 'week', 'interest_over_time', 'product', 'fixture', ?)`,
        ).run(sid, productId, r.title.toLowerCase(), pts[0]!.at, pts.at(-1)!.at, now.toISOString());
        for (const p of pts) db.prepare('INSERT INTO pr_signal_points (signal_id, at, value, below_one) VALUES (?, ?, ?, 0)').run(sid, p.at, p.value);
      }
      return productId;
    }),
  );
  ids.forEach((id, i) => (refreshProduct(db, id, now), i % 500 === 499 && log(`ranked ${i + 1} of ${ids.length}`)));
  return ids.length;
}
