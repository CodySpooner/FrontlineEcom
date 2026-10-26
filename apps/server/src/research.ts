import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { PRODUCT_WRITE_PLATFORMS, RESEARCH_TABS, type Niche, type ProductList, type ResearchProduct, type ResearchSource, type ResearchTab } from '@frontline/shared';
import { approvalsHook, getApproval } from './approvals';
import { tx, type Db } from './db';
import { convertRate } from './fx';
import { getStore } from './stores';

type Row = Record<string, unknown>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** AI Score: 35% margin (20%→0, 80%→1), 25% trend (log, +300%→1), 25% low competition, 15% shipping (5d→1, 20d→0). */
export function scoreProduct(p: { cost: number; price: number; trend: number; competition: number; shippingDays: number }) {
  const parts = {
    margin: clamp01(((p.price - p.cost) / p.price - 0.2) / 0.6),
    trend: clamp01(Math.log10(1 + Math.max(0, p.trend) / 100) / Math.log10(4)),
    competition: clamp01(1 - p.competition / 100),
    shipping: clamp01((20 - p.shippingDays) / 15),
  };
  const score = Math.round(100 * (0.35 * parts.margin + 0.25 * parts.trend + 0.25 * parts.competition + 0.15 * parts.shipping));
  return { score, scoreParts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100)])) as ResearchProduct['scoreParts'] };
}

const toProduct = (r: Row): ResearchProduct => {
  const p = { cost: Number(r.cost), price: Number(r.price), trend: Number(r.trend), competition: Number(r.competition), shippingDays: Number(r.shipping_days) };
  return {
    id: String(r.id),
    title: String(r.title),
    category: String(r.category),
    niche: r.niche as Niche,
    ...(r.niche_detail ? { nicheDetail: String(r.niche_detail) } : {}),
    ...(r.image ? { image: String(r.image) } : {}),
    source: r.source as ResearchSource,
    ...p,
    compareAt: Number(r.compare_at),
    margin: Math.round(((p.price - p.cost) / p.price) * 10000) / 100,
    ...scoreProduct(p),
  };
};

/** Tab = filter + sort. */
const TABS: Record<ResearchTab, { keep: (p: ResearchProduct) => boolean; by: (a: ResearchProduct, b: ResearchProduct) => number }> = {
  trending: { keep: () => true, by: (a, b) => b.trend - a.trend },
  high_margin: { keep: (p) => p.margin >= 70, by: (a, b) => b.margin - a.margin },
  low_competition: { keep: (p) => p.competition <= 35, by: (a, b) => a.competition - b.competition },
  tiktok_viral: { keep: (p) => p.source === 'tiktok', by: (a, b) => b.trend - a.trend },
  shopify_winners: { keep: (p) => p.source === 'shopify', by: (a, b) => b.score - a.score },
};

const getProduct = (db: Db, id: string) => {
  const r = db.prepare('SELECT * FROM research_products WHERE id = ?').get(id);
  return r ? toProduct(r) : undefined;
};

const getList = (db: Db, id: string): ProductList | undefined => {
  const r = db.prepare('SELECT * FROM product_lists WHERE id = ?').get(id);
  if (!r) return;
  const items = db.prepare('SELECT product_id FROM product_list_items WHERE list_id = ? ORDER BY added_at, rowid').all(id);
  return { id: String(r.id), name: String(r.name), productIds: items.map((i) => String(i.product_id)), createdAt: String(r.created_at) };
};

export function researchRoutes(db: Db) {
  return new Hono()
    .get('/api/research', (c) => {
      const tab = c.req.query('tab') as ResearchTab | undefined;
      if (tab && !RESEARCH_TABS.includes(tab)) return c.json({ error: `tab must be one of ${RESEARCH_TABS.join(', ')}` }, 400);
      const [niche, nicheDetail] = c.req.query('niche')?.split(':', 2) ?? []; // other:<slug> = one custom niche's
      const q = c.req.query('q')?.trim().toLowerCase();
      const offset = Math.max(0, Math.floor(Number(c.req.query('offset')) || 0));
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit')) || 50)));
      // ponytail: scores are computed in JS over the whole table; move scoring into SQL if the dataset passes ~10k rows
      const t = tab ? TABS[tab] : { keep: () => true, by: (a: ResearchProduct, b: ResearchProduct) => b.score - a.score };
      const all = db
        .prepare('SELECT * FROM research_products ORDER BY id')
        .all()
        .map(toProduct)
        .filter((p) => t.keep(p) && (!niche || p.niche === niche) && (!nicheDetail || p.nicheDetail === nicheDetail) && (!q || `${p.title} ${p.category}`.toLowerCase().includes(q)))
        .sort(t.by);
      return c.json({ items: all.slice(offset, offset + limit), total: all.length, offset, limit });
    })
    .get('/api/research/lists', (c) =>
      c.json(db.prepare('SELECT id FROM product_lists ORDER BY created_at, rowid').all().map((r) => getList(db, String(r.id))!)),
    )
    .post('/api/research/lists', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { name?: unknown } | undefined;
      const name = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 80) return c.json({ error: 'name must be 1-80 characters' }, 400);
      const id = randomUUID();
      db.prepare('INSERT INTO product_lists (id, name, created_at) VALUES (?, ?, ?)').run(id, name, new Date().toISOString());
      return c.json(getList(db, id), 201);
    })
    .delete('/api/research/lists/:id', (c) =>
      db.prepare('DELETE FROM product_lists WHERE id = ?').run(c.req.param('id')).changes ? c.body(null, 204) : c.json({ error: 'list not found' }, 404),
    )
    .on(['PUT', 'DELETE'], '/api/research/lists/:id/items/:productId', (c) => {
      const { id, productId } = c.req.param();
      if (!getList(db, id)) return c.json({ error: 'list not found' }, 404);
      if (c.req.method === 'PUT') {
        if (!getProduct(db, productId)) return c.json({ error: 'product not found' }, 404);
        db.prepare('INSERT OR IGNORE INTO product_list_items (list_id, product_id, added_at) VALUES (?, ?, ?)').run(id, productId, new Date().toISOString());
      } else {
        db.prepare('DELETE FROM product_list_items WHERE list_id = ? AND product_id = ?').run(id, productId);
      }
      return c.json(getList(db, id));
    })
    .get('/api/research/:id', (c) => {
      const p = getProduct(db, c.req.param('id'));
      return p ? c.json(p) : c.json({ error: 'product not found' }, 404);
    })
    .post('/api/research/:id/add-to-store', async (c) => {
      const p = getProduct(db, c.req.param('id'));
      if (!p) return c.json({ error: 'product not found' }, 404);
      const body = (await c.req.json().catch(() => undefined)) as { storeId?: unknown } | undefined;
      const store = typeof body?.storeId === 'string' ? getStore(db, body.storeId) : undefined;
      if (!store) return c.json({ error: 'storeId must be an existing store' }, 400);
      // Approving would do nothing on a platform the app doesn't write products to.
      if (store.connected && !PRODUCT_WRITE_PLATFORMS.includes(store.platform)) return c.json({ error: `Products are only added automatically to Shopify and WooCommerce stores for now. Add "${p.title}" to ${store.name} by hand.` }, 400);
      // Research prices are USD: converted to the store's currency, rounded to its minor unit. No rate: kept in USD, and the request says so.
      const rate = await convertRate(db, 'USD', store.currency);
      const digits = new Intl.NumberFormat('en', { style: 'currency', currency: store.currency }).resolvedOptions().maximumFractionDigits ?? 2;
      const money = (usd: number) => (rate ? Math.round(usd * rate * 10 ** digits) / 10 ** digits : usd);
      // Already asked (here, or by an agent): that request again rather than a second card for one product. After the
      // await, so a double click's second request sees the first's.
      const asked = db
        .prepare(
          `SELECT a.id FROM approvals a, json_each(a.action_json, '$.payload.products') p
           WHERE a.store_id = ? AND a.status = 'pending' AND a.action_json ->> '$.kind' = 'store.add_products' AND lower(trim(p.value ->> '$.title')) = lower(trim(?))`,
        )
        .get(store.id, p.title);
      if (asked) return c.json(getApproval(db, String(asked.id)));
      const approval = approvalsHook(db).create({
        storeId: store.id,
        agentId: `${store.id}:product_hunter`,
        title: `Add "${p.title}" to ${store.name}`,
        reason: `AI score ${p.score}, ${Math.round(p.margin)}% margin, demand +${p.trend}% in 30 days${rate ? '' : `. Prices are in USD (no ${store.currency} rate yet): adjust them before publishing`}`,
        action: { kind: 'store.add_products', payload: { products: [{ researchProductId: p.id, title: p.title, price: money(p.price), compareAt: money(p.compareAt), cost: money(p.cost) }] } },
      });
      return c.json(approval, 201);
    });
}

// [title, category, niche, source, cost, price, compareAt, trend %, competition 0-100, shipping days]
export const DEMO: [string, string, Niche, ResearchSource, number, number, number, number, number, number][] = [
  ['Electric Scalp Massager', 'Health & Beauty', 'beauty', 'tiktok', 3.9, 14.32, 49.99, 248, 28, 7],
  ['Portable Car Vacuum', 'Automotive', 'tech', 'tiktok', 6.2, 18.25, 59.99, 196, 35, 8],
  ['LED Motion Light', 'Home & Living', 'home', 'shopify', 3.1, 12.4, 33.99, 172, 30, 9],
  ['Magnetic Phone Mount', 'Electronics', 'tech', 'amazon', 2.4, 9.2, 29.99, 166, 42, 6],
  ['3-in-1 Wireless Charger', 'Electronics', 'tech', 'shopify', 5.8, 16.5, 49.99, 153, 48, 8],
  ['Ice Facial Roller', 'Beauty', 'beauty', 'tiktok', 2.6, 11.3, 34.99, 141, 33, 7],
  ['Pet Water Fountain', 'Pet Supplies', 'pet', 'shopify', 5.1, 14.75, 44.99, 138, 38, 10],
  ['Mini Projector', 'Electronics', 'tech', 'aliexpress', 14.2, 28.9, 69.99, 132, 55, 12],
  ['LED Light Therapy Mask', 'Beauty', 'beauty', 'tiktok', 18.5, 59.99, 149.99, 121, 40, 9],
  ['Heatless Curling Ribbon', 'Beauty', 'beauty', 'tiktok', 1.4, 9.99, 24.99, 205, 52, 8],
  ['Blackhead Vacuum Pore Cleaner', 'Beauty', 'beauty', 'amazon', 4.2, 15.99, 39.99, 64, 71, 7],
  ['Magnetic Eyelashes Kit', 'Beauty', 'beauty', 'shopify', 2.9, 17.99, 34.99, 66, 74, 8],
  ['Dog Paw Cleaner Cup', 'Pet Supplies', 'pet', 'tiktok', 2.3, 12.99, 29.99, 182, 31, 9],
  ['Self-Cleaning Slicker Brush', 'Pet Supplies', 'pet', 'amazon', 2.1, 11.99, 24.99, 77, 66, 7],
  ['Interactive Cat Laser Toy', 'Pet Supplies', 'pet', 'tiktok', 3.6, 16.99, 34.99, 158, 29, 11],
  ['Calming Donut Pet Bed', 'Pet Supplies', 'pet', 'shopify', 9.8, 32.99, 59.99, 89, 58, 13],
  ['Lick Mat Slow Feeder', 'Pet Supplies', 'pet', 'aliexpress', 1.2, 9.99, 19.99, 112, 24, 14],
  ['Smart Jump Rope', 'Fitness', 'fitness', 'tiktok', 4.7, 19.99, 39.99, 134, 36, 9],
  ['Wall Pilates Bar Kit', 'Fitness', 'fitness', 'tiktok', 11.4, 39.99, 79.99, 226, 22, 12],
  ['Weighted Hula Hoop', 'Fitness', 'fitness', 'shopify', 6.3, 24.99, 44.99, 97, 45, 10],
  ['Massage Gun Mini', 'Fitness', 'fitness', 'amazon', 16.8, 44.99, 99.99, 58, 78, 7],
  ['Resistance Band Booty Set', 'Fitness', 'fitness', 'aliexpress', 2.2, 14.99, 29.99, 71, 69, 15],
  ['Under-Desk Walking Pad', 'Fitness', 'fitness', 'amazon', 98, 219.99, 399.99, 91, 61, 6],
  ['Sunset Projection Lamp', 'Home & Living', 'home', 'tiktok', 4.9, 19.99, 39.99, 117, 50, 10],
  ['Cloud Slides', 'Fashion', 'fashion', 'tiktok', 3.8, 19.99, 39.99, 144, 62, 9],
  ['Crossbody Phone Bag', 'Fashion', 'fashion', 'tiktok', 3.2, 21.99, 39.99, 118, 47, 10],
  ['Minimalist Ring Set', 'Fashion', 'fashion', 'shopify', 1.6, 14.99, 29.99, 93, 51, 12],
  ['Rechargeable Milk Frother', 'Home & Living', 'home', 'amazon', 2.8, 14.99, 29.99, 86, 57, 8],
  ['Portable Neck Fan', 'Outdoor', 'outdoor', 'amazon', 4.1, 19.99, 34.99, 108, 53, 9],
  ['Bubble Machine Gun', 'Kids & Toys', 'kids', 'tiktok', 3.4, 16.99, 32.99, 151, 41, 10],
  ['Waterproof Phone Pouch', 'Outdoor', 'outdoor', 'amazon', 1.1, 8.99, 19.99, 49, 44, 8],
  ['Collapsible Camping Lantern', 'Outdoor', 'outdoor', 'shopify', 5.4, 22.99, 39.99, 83, 27, 11],
  ['Kids Drawing Projector', 'Kids & Toys', 'kids', 'tiktok', 6.7, 24.99, 49.99, 167, 34, 12],
  ['Montessori Busy Board', 'Kids & Toys', 'kids', 'shopify', 7.9, 29.99, 54.99, 102, 39, 13],
  ['Bluetooth Sleep Headband', 'Electronics', 'tech', 'tiktok', 5.6, 22.99, 44.99, 129, 37, 10],
];

/** Seeds the demo research dataset into an empty table. */
export function seedResearch(db: Db) {
  if (db.prepare('SELECT count(*) AS n FROM research_products').get()?.n) return;
  const ins = db.prepare(
    'INSERT INTO research_products (id, title, category, niche, source, cost, price, compare_at, trend, competition, shipping_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  tx(db, () => DEMO.forEach(([title, ...rest]) => ins.run(title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, ...rest)));
}
