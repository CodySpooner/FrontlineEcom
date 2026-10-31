// SA-91 (decision 22): cross-channel product links. A channel's own product (TikTok Shop's `tt-…`) rolls into the store
// product it's linked to, by the platform's documented id (SA-55) or the owner's mapping here, never by SKU or title:
// its listings and sales count on that product's Listings row and drawer (split by channel there) and it has no row of
// its own. Unlinked, it's its own row again ("TikTok Shop only").
import type { SaProductLink } from '@frontline/shared';
import type { Db } from '../db';

/** SQL: the store's channel products rolled into a product that exists (one param, the store id). */
export const ROLLED = 'SELECT k.channel_product_id FROM product_links k JOIN products t ON t.store_id = k.store_id AND t.id = k.product_id WHERE k.store_id = ?';

/** Channel product → the store product it rolls into. */
export function linkMap(db: Db, storeId: string) {
  return new Map(
    db
      .prepare(ROLLED.replace('SELECT k.channel_product_id', 'SELECT k.channel_product_id AS c, k.product_id AS p'))
      .all(storeId)
      .map((r) => [String(r.c), String(r.p)]),
  );
}

/** These products and the channel products rolled into them. */
export function withLinked(db: Db, storeId: string, ids: string[]) {
  const linked = db.prepare('SELECT channel_product_id AS c FROM product_links WHERE store_id = ? AND product_id IN (SELECT value FROM json_each(?))').all(storeId, JSON.stringify(ids));
  return [...new Set([...ids, ...linked.map((r) => String(r.c))])];
}

/** A store product's links, each with how it was made. */
export function productLinks(db: Db, storeId: string, productId: string): SaProductLink[] {
  return db
    .prepare(
      `SELECT k.channel, k.channel_product_id AS id, p.title, k.method, k.created_at AS at FROM product_links k LEFT JOIN products p ON p.store_id = k.store_id AND p.id = k.channel_product_id
       WHERE k.store_id = ? AND k.product_id = ? ORDER BY k.channel, k.channel_product_id`,
    )
    .all(storeId, productId)
    .map((r) => ({ channel: String(r.channel), channelProductId: String(r.id), title: r.title == null ? null : String(r.title), method: r.method === 'owner' ? 'owner' : 'platform_id', createdAt: String(r.at) }));
}

type Refused = { refused: string; status: 400 | 404 | 409 };

/** The owner's mapping: `channelProductId`, listed only on channels other than the store's own, rolls into `productId`. */
export function setLink(db: Db, storeId: string, channelProductId: unknown, productId: unknown, now = new Date()): Refused | SaProductLink {
  if (typeof channelProductId !== 'string' || typeof productId !== 'string' || !channelProductId || !productId) return { refused: 'channelProductId and productId are required', status: 400 };
  const has = db.prepare('SELECT 1 FROM products WHERE store_id = ? AND id = ?');
  if (!has.get(storeId, channelProductId) || !has.get(storeId, productId)) return { refused: 'No such product in this store', status: 404 };
  if (channelProductId === productId) return { refused: "A product can't be linked to itself", status: 400 };
  const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)!.platform);
  const own = platform === 'shopify' || platform === 'woocommerce' ? 'site' : platform;
  const l = db.prepare('SELECT max(channel = ?1) AS own, min(iif(channel = ?1, NULL, channel)) AS channel FROM channel_listings WHERE store_id = ?2 AND product_id = ?3').get(own, storeId, channelProductId)!;
  if (l.own || l.channel == null) return { refused: "Only a product listed on another channel than the store's own can be linked", status: 400 };
  if (db.prepare('SELECT 1 FROM product_links WHERE store_id = ? AND channel_product_id = ?').get(storeId, productId)) return { refused: 'That product is itself linked to another product', status: 400 };
  if (db.prepare('SELECT 1 FROM product_links WHERE store_id = ? AND product_id = ?').get(storeId, channelProductId)) return { refused: 'Other products are linked to that one', status: 400 };
  // The owner's mapping replaces a platform-id link, and a sync never overwrites it (SA-55).
  db.prepare(
    `INSERT INTO product_links (store_id, channel, channel_product_id, product_id, method, created_at) VALUES (?, ?, ?, ?, 'owner', ?)
     ON CONFLICT (store_id, channel, channel_product_id) DO UPDATE SET product_id = excluded.product_id, method = 'owner', created_at = excluded.created_at`,
  ).run(storeId, String(l.channel), channelProductId, productId, now.toISOString());
  return productLinks(db, storeId, productId).find((k) => k.channelProductId === channelProductId)!;
}

/** Unlinks the owner's mapping; a platform-id link stays (the next sync would make it again). */
export function deleteLink(db: Db, storeId: string, channelProductId: unknown): Refused | { deleted: string } {
  if (typeof channelProductId !== 'string' || !channelProductId) return { refused: 'channelProductId is required', status: 400 };
  const k = db.prepare('SELECT method FROM product_links WHERE store_id = ? AND channel_product_id = ?').get(storeId, channelProductId);
  if (!k) return { refused: 'That product has no link', status: 404 };
  if (k.method !== 'owner') return { refused: "The channel's own product id links it (decision 22): its next sync would link it again", status: 409 };
  db.prepare('DELETE FROM product_links WHERE store_id = ? AND channel_product_id = ?').run(storeId, channelProductId);
  return { deleted: channelProductId };
}
