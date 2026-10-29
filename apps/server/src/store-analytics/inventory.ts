// SA-50 (decision 27): inventory is point in time. One snapshot per tracked variant and store-local day, for real
// stores only, taken after a sync whose variants read succeeded; readers take one value per date, never a sum.
import type { Db } from '../db';
import { localDate } from '../dates';
import { storeZone } from '../stores';

/**
 * Today's stock of each tracked variant with a count, unless today already has one: the day's first successful catalog
 * sync sets it. `since` is when the sync began: its variants read must have succeeded after it.
 */
export function snapshotInventory(db: Db, storeId: string, integrationId: string, since: Date, now = new Date()) {
  const zone = storeZone(db, storeId); // undefined for a demo store: stock history isn't recorded for it
  if (!zone) return;
  const read = db
    .prepare("SELECT 1 FROM source_datasets WHERE integration_id = ? AND dataset = 'variants' AND status IN ('available', 'partial') AND last_success_at >= ?")
    .get(integrationId, since.toISOString());
  if (!read) return;
  db.prepare(
    `INSERT OR IGNORE INTO inventory_snapshots (store_id, variant_id, date, quantity, tracked)
     SELECT store_id, id, ?, inventory, 1 FROM product_variants WHERE store_id = ? AND inventory_tracked = 1 AND inventory IS NOT NULL`,
  ).run(localDate(now, zone), storeId);
}

/** A variant's stock on one store day, or null when none was recorded that day. */
export function stockAt(db: Db, storeId: string, variantId: string, date: string): number | null {
  const r = db.prepare('SELECT quantity FROM inventory_snapshots WHERE store_id = ? AND variant_id = ? AND date = ?').get(storeId, variantId, date);
  return r?.quantity == null ? null : Number(r.quantity);
}
