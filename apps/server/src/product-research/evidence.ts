import { randomUUID } from 'node:crypto';
import { once, tx, type Db } from '../db';

const DAY = 86_400_000;
const WEEKS = 104;
const day = (d: Date) => d.toISOString().slice(0, 10);
const weekStart = (d: string) => day(new Date(Date.parse(d) - new Date(d).getUTCDay() * DAY)); // Sunday, as Trends dates weeks

/**
 * Measured demand from a store's own paid orders (decision 4): weekly units of the store products linked to this
 * research product, as one product-level set private to the store (platform `orders`, metric `units_sold`, origin
 * `live`), from the first week with a sale to the last complete week, at most two years. Only for stores with
 * `demo = 0`: a demo store's orders are generated and never count, so it gets no set.
 */
export function refreshOrders(db: Db, storeId: string, productId: string, now = new Date()) {
  const real = db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo === 0;
  const refs = db.prepare(`SELECT ref_id FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind = 'store_product'`).all(storeId, productId).map((r) => String(r.ref_id));
  const old = db.prepare(`SELECT id FROM pr_signals WHERE store_id = ? AND product_id = ? AND platform = 'orders'`).get(storeId, productId);
  tx(db, () => {
    if (old) db.prepare('DELETE FROM pr_signals WHERE id = ?').run(String(old.id));
    if (!real || !refs.length) return;
    const thisWeek = weekStart(day(now));
    const from = day(new Date(Date.parse(thisWeek) - WEEKS * 7 * DAY));
    const sales = db
      .prepare(
        `SELECT o.local_date AS d, sum(i.quantity) AS units FROM order_items i JOIN orders o ON o.store_id = i.store_id AND o.id = i.order_id
         WHERE i.store_id = ? AND i.product_id IN (${refs.map(() => '?').join(', ')}) AND o.status = 'paid' AND o.local_date >= ? AND o.local_date < ?
         GROUP BY o.local_date ORDER BY o.local_date`,
      )
      .all(storeId, ...refs, from, thisWeek);
    const byWeek = new Map<string, number>();
    for (const s of sales) byWeek.set(weekStart(String(s.d)), (byWeek.get(weekStart(String(s.d))) ?? 0) + Number(s.units));
    const weeks: string[] = [];
    for (let t = Date.parse([...byWeek.keys()][0] ?? thisWeek); t < Date.parse(thisWeek); t += 7 * DAY) weeks.push(day(new Date(t)));
    const id = randomUUID();
    db.prepare(
      `INSERT INTO pr_signals (id, store_id, product_id, platform, query, period_start, period_end, granularity, metric, scope, origin, retrieved_at)
       VALUES (?, ?, ?, 'orders', NULL, ?, ?, 'week', 'units_sold', 'product', 'live', ?)`,
    ).run(id, storeId, productId, weeks[0] ?? null, weeks.at(-1) ?? null, now.toISOString());
    const point = db.prepare('INSERT INTO pr_signal_points (signal_id, at, value) VALUES (?, ?, ?)');
    for (const w of weeks) point.run(id, w, byWeek.get(w) ?? 0);
  });
}

/** The owner says a research product is one of the store's own products (PR-20 adds the check that suggests it). */
export function linkStoreProduct(db: Db, storeId: string, productId: string, storeProductId: string, now = new Date()): string | null {
  if (!db.prepare('SELECT 1 FROM products WHERE store_id = ? AND id = ?').get(storeId, storeProductId)) return 'store product not found';
  db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, created_at) VALUES (?, ?, ?, 'store_product', ?, ?)`).run(randomUUID(), storeId, productId, storeProductId, now.toISOString());
  refreshOrders(db, storeId, productId, now);
  return null;
}

/** Once a day: every linked product's order set, so the last complete week is always in. */
export function refreshAllOrders(db: Db, now = new Date()) {
  if (!once(db, `pr:orders:${day(now)}`)) return;
  for (const r of db.prepare(`SELECT DISTINCT store_id, product_id FROM pr_outcomes WHERE kind = 'store_product'`).all()) refreshOrders(db, String(r.store_id), String(r.product_id), now);
}

export const NOTE_PLATFORMS = ['tiktok_creative_center'] as const;

/**
 * A manual research note (decision 4: TikTok Creative Center is Manual research only): what the owner saw, the link
 * and the date, private to the store. Nothing is fetched; a note never has a demand class and never counts as evidence.
 */
export function addNote(db: Db, storeId: string, productId: string, n: { platform: string; url: string; note: string; observedAt: string }) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO pr_signals (id, store_id, product_id, platform, metric, scope, origin, note, url, retrieved_at) VALUES (?, ?, ?, ?, 'manual_note', 'product', 'manual', ?, ?, ?)`,
  ).run(id, storeId, productId, n.platform, n.note, n.url, n.observedAt);
  return id;
}
