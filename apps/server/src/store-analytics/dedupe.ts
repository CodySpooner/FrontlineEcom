// SA-51 (decision 13): a store-platform order (Shopify, WooCommerce) whose channel is a marketplace with its own synced
// integration for the store is that marketplace's copy inside the days the integration covers, matched or not.
// `duplicate_of` names the marketplace's order by the channel's order id (the match only labels the pair). Never by
// name, email, amount or time; orders from an unmapped app are never marked.
import { SA_SOURCES, type SaDedupe, type SaSourceKind } from '@frontline/shared';
import { rebuildRevenue } from '../connectors/common';
import { tx, type Db } from '../db';
import { CANONICAL } from './sales';

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

/** SA-52: per marketplace channel, the copies left out (matched or not) and those counted outside its synced days, over orders placed in [from, to]. */
export function dedupeSummary(db: Db, storeId: string, from: string, to: string): SaDedupe {
  const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)?.platform);
  const count = db.prepare(
    `SELECT count(*) FILTER (WHERE o.duplicate_of IS NOT NULL AND m.id IS NOT NULL) AS matched, count(*) FILTER (WHERE o.duplicate_of IS NOT NULL AND m.id IS NULL) AS unmatched,
       count(*) FILTER (WHERE ${CANONICAL}) AS outside
     FROM orders o LEFT JOIN orders m ON m.store_id = o.store_id AND m.id = o.duplicate_of
     WHERE o.store_id = ? AND o.source_kind = ? AND o.channel = ? AND o.local_date BETWEEN ? AND ?`,
  );
  const channels = Object.keys(PREFIX)
    .map((channel) => {
      const r = count.get(storeId, platform, channel, from, to)!;
      return { channel, matched: Number(r.matched), unmatched: Number(r.unmatched), outside: Number(r.outside) };
    })
    .filter((c) => c.matched || c.unmatched || c.outside);
  const unmapped = Number(
    db.prepare(`SELECT count(*) AS n FROM orders o WHERE o.store_id = ? AND o.source_kind = ? AND o.channel = 'other' AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`).get(storeId, platform, from, to)!.n,
  );
  const name = (k: string) => SA_SOURCES[k as SaSourceKind]?.name ?? k;
  const lines = channels.flatMap((c) => [
    ...(c.matched || c.unmatched ? [`${c.matched} ${name(c.channel)} orders matched, 0 counted twice`] : []),
    ...(c.unmatched ? [`${c.unmatched} ${c.unmatched === 1 ? 'copy' : 'copies'} left out without a match`] : []),
    ...(c.outside ? [`${c.outside} ${name(c.channel)} orders counted from ${name(platform)}, outside the days ${name(c.channel)} has synced`] : []),
  ]);
  if (unmapped) lines.push(`${unmapped} orders from other sales-channel apps may duplicate a marketplace's: they're never matched automatically`);
  return { channels, unmapped, lines };
}
