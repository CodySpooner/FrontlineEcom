// SA-18: the demo stores' catalog structure (decision 30).
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db';
import { seedDemo, seedDemoCatalog } from '../demo';
import { insertStore } from '../stores';

const TABLES = ['product_variants', 'channel_listings', 'product_links', 'product_collections'];
const q = (db: Db, t: string, storeId: string) => db.prepare(`SELECT * FROM ${t} WHERE store_id = ? ORDER BY 1, 2, 3`).all(storeId);
const rows = (db: Db, storeId: string) => ({
  product_variants: q(db, 'product_variants', storeId),
  channel_listings: q(db, 'channel_listings', storeId),
  product_links: q(db, 'product_links', storeId),
  product_collections: q(db, 'product_collections', storeId),
});

describe('seedDemoCatalog', () => {
  it('gives each demo store variants, listings, one link and two collections, the same on every seed', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const first: Record<string, ReturnType<typeof rows>> = Object.fromEntries(['pawsome', 'glow', 'peak'].map((id) => [id, rows(db, id)]));
    seedDemo(db, '2026-10-27');
    for (const id of ['pawsome', 'glow', 'peak']) {
      expect(rows(db, id)).toEqual(first[id]);
      const r = first[id]!;
      expect(r.product_links).toHaveLength(1);
      expect(new Set(r.product_collections.map((c) => c.collection_id)).size).toBe(2);
      expect(r.product_variants.length).toBeGreaterThan(6); // six products, two of them with more than one variant
    }
    // The board's niche store sells on its site and TikTok Shop; the TikTok Shop store's own channel is TikTok Shop.
    const channels = (id: string) => [...new Set(first[id]!.channel_listings.map((l) => `${l.channel}`))].sort();
    expect(channels('glow')).toEqual(['site', 'tiktok_shop']);
    expect(first.glow!.channel_listings.filter((l) => l.channel === 'tiktok_shop')).toHaveLength(4);
    expect(first.peak!.channel_listings.filter((l) => l.channel === 'tiktok_shop')).toHaveLength(6);
    // One variant out of stock; variant stock adds up to the product's.
    const v = first.glow!.product_variants.filter((x) => x.product_id === 'glow-p2');
    expect(v.map((x) => x.inventory)).toEqual([db.prepare("SELECT inventory FROM products WHERE store_id = 'glow' AND id = 'glow-p2'").get()!.inventory, 0]);
    // No fake ledger, stock snapshot or customer rows.
    for (const t of ['order_lines', 'refunds', 'unit_costs', 'inventory_snapshots']) expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n, t).toBe(0);
  });

  it('a real store gets none', () => {
    const db = openDb();
    insertStore(db, { id: 'real', name: 'Real Shop', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    db.prepare("INSERT INTO products (store_id, id, title, price, compare_at, cost, inventory, status) VALUES ('real', 'r1', 'Serum', 30, 40, 8, 10, 'active')").run();
    seedDemoCatalog(db, 'real');
    for (const t of TABLES) expect(db.prepare(`SELECT count(*) AS n FROM ${t}`).get()!.n, t).toBe(0);
  });
});
