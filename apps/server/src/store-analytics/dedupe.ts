// SA-51 (decision 13): a store-platform order (Shopify, WooCommerce) whose channel is a marketplace with its own synced
// integration for the store is that marketplace's copy inside the days the integration covers, matched or not.
// `duplicate_of` names the marketplace's order by the channel's order id (the match only labels the pair). Never by
// name, email, amount or time; orders from an unmapped app are never marked.
import { rebuildRevenue } from '../connectors/common';
import { tx, type Db } from '../db';

/** How the app ids each marketplace's own orders (the connectors' prefixes). */
const PREFIX: Record<string, string> = { tiktok_shop: 'tt-', amazon: 'amz-', etsy: 'etsy-' };

/** Recomputes the store's marks from scratch; legacy revenue is rebuilt on the days whose marks changed. */
export function markChannelCopies(db: Db, storeId: string) {
  const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform);
  if (platform !== 'shopify' && platform !== 'woocommerce') return;
  // Each marketplace's covered days: its orders read's range; Amazon as a channel (daily totals only) its channel_daily days.
  const covers = new Map<string, (day: string) => boolean>();
  for (const kind of Object.keys(PREFIX)) {
    if (!db.prepare('SELECT 1 FROM integrations WHERE store_id = ? AND kind = ?').get(storeId, kind)) continue;
    if (kind === 'amazon') {
      const days = new Set(db.prepare("SELECT date FROM channel_daily WHERE store_id = ? AND channel = 'amazon'").all(storeId).map((r) => String(r.date)));
      covers.set(kind, (d) => days.has(d));
      continue;
    }
    const r = db
      .prepare("SELECT covered_from AS f, covered_to AS t FROM source_datasets WHERE integration_id = ? AND dataset = 'orders' AND status IN ('available', 'partial', 'verified') AND covered_from IS NOT NULL")
      .get(`${kind}:${storeId}`);
    if (r) covers.set(kind, (d) => d >= String(r.f) && d <= String(r.t));
  }
  const mark = db.prepare('UPDATE orders SET duplicate_of = ? WHERE store_id = ? AND id = ?');
  const changed = new Set<string>();
  tx(db, () => {
    const orders = db
      .prepare(`SELECT id, local_date AS day, channel, channel_order_id AS ref, duplicate_of AS was FROM orders WHERE store_id = ? AND source_kind = ? AND (channel IN (${Object.keys(PREFIX).map(() => '?').join(', ')}) OR duplicate_of IS NOT NULL)`)
      .all(storeId, platform, ...Object.keys(PREFIX));
    for (const o of orders) {
      const kind = String(o.channel);
      // No channel order id: still a copy, labelled with the marketplace alone.
      const label = covers.get(kind)?.(String(o.day)) ? (o.ref ? `${PREFIX[kind]}${o.ref}` : kind) : null;
      if (label === (o.was ?? null)) continue;
      mark.run(label, storeId, String(o.id));
      changed.add(String(o.day));
    }
    if (changed.size) rebuildRevenue(db, storeId, changed);
  });
}
