import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { AdSnapshotData, Competitor, CompetitorSnapshot, PriceChange, PriceSnapshotData } from '@frontline/shared';
import { once, tx, type Db } from './db';
import { addDays, localDate } from './dates';
import { hash, mulberry32 } from './demo';
import { getCredentials } from './integrations';
import { log } from './log';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const httpUrl = (v: unknown) => {
  try {
    return typeof v === 'string' && /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};
const str = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;

export function listCompetitors(db: Db, storeIds: string[], today = localDate()): Competitor[] {
  if (!storeIds.length) return [];
  const rows = db.prepare(`SELECT * FROM competitors WHERE store_id IN (${storeIds.map(() => '?').join(',')}) ORDER BY created_at, rowid`).all(...storeIds);
  const products = db.prepare("SELECT count(DISTINCT json_extract(data_json, '$.product')) AS n FROM competitor_snapshots WHERE competitor_id = ? AND kind = 'price'");
  const ads = db.prepare("SELECT count(*) AS n FROM competitor_snapshots WHERE competitor_id = ? AND kind = 'ad' AND json_extract(data_json, '$.lastSeen') >= ?");
  return rows.map((r) => ({
    id: String(r.id),
    storeId: String(r.store_id),
    name: String(r.name),
    url: String(r.url),
    ...(r.notes ? { notes: String(r.notes) } : {}),
    createdAt: String(r.created_at),
    productsTracked: Number(products.get(r.id as string)?.n),
    activeAds: Number(ads.get(r.id as string, addDays(today, -3))?.n),
  }));
}

const toSnapshot = (r: Row) => ({ id: String(r.id), competitorId: String(r.competitor_id), kind: r.kind, capturedAt: String(r.captured_at), data: JSON.parse(String(r.data_json)) }) as CompetitorSnapshot;

/** Validates snapshot data at the boundary. Returns an error message or undefined. */
function snapshotError(kind: unknown, d: unknown): string | undefined {
  if (!isObj(d)) return 'data must be an object';
  if (kind === 'price') {
    if (!str(d.product, 200)) return 'data.product must be 1-200 characters';
    if (typeof d.price !== 'number' || !(d.price > 0)) return 'data.price must be a positive number';
    if (d.compareAt !== undefined && (typeof d.compareAt !== 'number' || !(d.compareAt > 0))) return 'data.compareAt must be a positive number';
    if (d.currency !== undefined && !iso(d.currency).currency) return 'data.currency must be a 3-letter ISO code';
    return;
  }
  if (kind === 'ad') {
    if (!['meta', 'tiktok', 'google'].includes(d.network as string)) return 'data.network must be meta, tiktok or google';
    if (!['image', 'video', 'carousel'].includes(d.format as string)) return 'data.format must be image, video or carousel';
    if (!str(d.headline, 200) || !str(d.body, 2000)) return 'data.headline (≤200) and data.body (≤2000) are required';
    if (d.cta !== undefined && !str(d.cta, 40)) return 'data.cta must be 1-40 characters';
    if (!isDate(d.firstSeen) || !isDate(d.lastSeen)) return 'data.firstSeen and data.lastSeen must be YYYY-MM-DD';
    if (d.landingUrl !== undefined && !httpUrl(d.landingUrl)) return 'data.landingUrl must be an http(s) URL';
    return;
  }
  return 'kind must be price or ad';
}

/** Records what an agent or scraper saw. Data must already be valid. */
export function addSnapshot(db: Db, competitorId: string, s: { kind: 'price'; data: PriceSnapshotData } | { kind: 'ad'; data: AdSnapshotData }, capturedAt = new Date().toISOString()) {
  const id = randomUUID();
  db.prepare('INSERT INTO competitor_snapshots (id, competitor_id, kind, captured_at, data_json) VALUES (?, ?, ?, ?, ?)').run(id, competitorId, s.kind, capturedAt, JSON.stringify(s.data));
  return { id, competitorId, capturedAt, ...s } as CompetitorSnapshot;
}

/** Consecutive price snapshots of the same product that differ, newest first. */
export function priceChanges(db: Db, storeIds: string[], limit: number): PriceChange[] {
  if (!storeIds.length) return [];
  const rows = db
    .prepare(
      `SELECT s.competitor_id, c.store_id, s.captured_at, json_extract(s.data_json, '$.product') AS product, json_extract(s.data_json, '$.price') AS price,
         json_extract(s.data_json, '$.currency') AS currency
       FROM competitor_snapshots s JOIN competitors c ON c.id = s.competitor_id
       WHERE s.kind = 'price' AND c.store_id IN (${storeIds.map(() => '?').join(',')}) ORDER BY s.competitor_id, product, s.captured_at`,
    )
    .all(...storeIds);
  const out: PriceChange[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.competitor_id !== r.competitor_id || prev.product !== r.product || prev.price === r.price) return;
    const from = Number(prev.price), to = Number(r.price);
    out.push({ competitorId: String(r.competitor_id), storeId: String(r.store_id), product: String(r.product), from, to, changePct: Math.round(((to - from) / from) * 10000) / 100, at: String(r.captured_at), ...iso(r.currency) });
  });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

type Fetch = typeof fetch;
interface StorefrontProduct {
  title?: string;
  variants?: { price: string; compare_at_price: string | null }[];
}
interface WooStoreProduct {
  name?: string;
  /** Strings in minor units; a variable product's `price` is its lowest variation's. */
  prices?: { price?: string; regular_price?: string; currency_minor_unit?: number; currency_code?: string };
}
type Priced = Omit<PriceSnapshotData, 'product'> & { product?: string };
/** `{ currency }` when `c` is an ISO currency code, else nothing. */
const iso = (c: unknown): { currency?: string } => (typeof c === 'string' && /^[A-Z]{3}$/.test(c) ? { currency: c } : {});

const get = (url: string, fetchFn: Fetch) => fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
const decodeHtml = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A Shopify storefront's public `/products.json` (1,000 products at most): each product's lowest variant price. */
async function shopifyCatalog(origin: string, fetchFn: Fetch): Promise<Priced[] | undefined> {
  const out: Priced[] = [];
  for (let page = 1; page <= 4; page++) {
    const res = await get(`${origin}/products.json?limit=250&page=${page}`, fetchFn);
    const body = res.ok ? ((await res.json().catch(() => undefined)) as { products?: StorefrontProduct[] } | undefined) : undefined;
    if (!Array.isArray(body?.products)) {
      if (page === 1) return;
      break;
    }
    for (const p of body.products) {
      const v = (p.variants ?? []).map((x) => ({ price: Number(x.price), compareAt: Number(x.compare_at_price) })).filter((x) => x.price > 0).sort((a, b) => a.price - b.price)[0];
      if (v) out.push({ product: p.title, price: v.price, ...(v.compareAt > v.price ? { compareAt: v.compareAt } : {}) });
    }
    if (body.products.length < 250) break;
  }
  // /products.json has no currency; the shop's public /meta.json does.
  if (!out.length) return out;
  const meta = (await get(`${origin}/meta.json`, fetchFn).then((r) => r.json()).catch(() => undefined)) as { currency?: unknown } | undefined;
  return out.map((p) => ({ ...p, ...iso(meta?.currency) }));
}

/** A WooCommerce store's public Store API (`/wp-json/wc/store/v1/products`, 1,000 products at most). */
async function wooCatalog(origin: string, fetchFn: Fetch): Promise<Priced[] | undefined> {
  const out: Priced[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, fetchFn);
    const body = res.ok ? ((await res.json().catch(() => undefined)) as WooStoreProduct[] | undefined) : undefined;
    if (!Array.isArray(body)) {
      if (page === 1) return;
      break;
    }
    for (const p of body) {
      const unit = 10 ** (p.prices?.currency_minor_unit ?? 2);
      const price = Number(p.prices?.price) / unit;
      const regular = Number(p.prices?.regular_price) / unit;
      if (price > 0) out.push({ product: p.name && decodeHtml(p.name), price, ...(regular > price ? { compareAt: regular } : {}), ...iso(p.prices?.currency_code) });
    }
    if (body.length < 100) break;
  }
  return out;
}

/**
 * An Etsy shop's active listings (Etsy Open API, 1,000 at most), read with a connected Etsy store's app key. Undefined
 * when no Etsy store is connected. ponytail: an Etsy listing carries no sale price, so there's no compare-at.
 */
async function etsyCatalog(db: Db, key: Buffer | undefined, url: URL, fetchFn: Fetch): Promise<Priced[] | undefined> {
  const name = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shop\/([a-z0-9]+)/i.exec(url.pathname)?.[1];
  const r = name && key ? db.prepare("SELECT store_id FROM integrations WHERE kind = 'etsy' ORDER BY updated_at DESC").get() : undefined;
  const creds = r ? getCredentials(db, key!, 'etsy', String(r.store_id)) : undefined;
  if (!name || !creds?.apiKey || !creds.sharedSecret) return;
  const api = async <T>(path: string) => {
    const res = await fetchFn(`https://openapi.etsy.com/v3/application${path}`, {
      headers: { accept: 'application/json', 'x-api-key': `${creds.apiKey}:${creds.sharedSecret}` }, signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Etsy: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const shop = (await api<{ results?: { shop_id: number; shop_name: string }[] }>(`/shops?shop_name=${encodeURIComponent(name)}`))
    .results?.find((s) => s.shop_name.toLowerCase() === name.toLowerCase());
  if (!shop) throw new Error(`no Etsy shop named ${name}`);
  const out: Priced[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = (await api<{ results?: { title?: string; price?: { amount: number; divisor: number; currency_code?: string } }[] }>(`/shops/${shop.shop_id}/listings/active?limit=100&offset=${offset}`)).results ?? [];
    for (const l of page) {
      const price = l.price?.divisor ? l.price.amount / l.price.divisor : 0;
      if (price > 0) out.push({ product: l.title && decodeHtml(l.title), price, ...iso(l.price?.currency_code) });
    }
    if (page.length < 100) break;
  }
  return out;
}

/**
 * Reads a competitor's public catalog (an Etsy shop, a Shopify storefront, else a WooCommerce store) and records a price snapshot for
 * each product whose lowest price or its compare-at changed since the last one. Returns how many it recorded, or
 * undefined when the site is neither.
 */
export async function watchCompetitorPrices(db: Db, competitorId: string, url: string, fetchFn: Fetch = fetch, now = new Date(), key?: Buffer) {
  const u = new URL(url);
  const products = /(^|\.)etsy\.com$/.test(u.hostname) ? await etsyCatalog(db, key, u, fetchFn)
    : ((await shopifyCatalog(u.origin, fetchFn)) ?? (await wooCatalog(u.origin, fetchFn)));
  if (!products) return;
  const latest = new Map(
    db.prepare("SELECT data_json FROM competitor_snapshots WHERE competitor_id = ? AND kind = 'price' ORDER BY captured_at, rowid").all(competitorId)
      .map((r) => JSON.parse(String(r.data_json)) as PriceSnapshotData)
      .map((d) => [d.product, d]),
  );
  const seen = new Set<string>();
  let added = 0;
  tx(db, () => {
    for (const p of products) {
      const product = p.product?.trim().slice(0, 200);
      if (!product || seen.has(product)) continue;
      seen.add(product);
      const data: PriceSnapshotData = { ...p, product };
      const prev = latest.get(product);
      if (prev && prev.price === data.price && prev.compareAt === data.compareAt) continue;
      addSnapshot(db, competitorId, { kind: 'price', data }, now.toISOString());
      added++;
    }
  });
  return added;
}

/**
 * Checks every competitor's prices once a day (hourly ticks, one site at a time). The demo competitors live on the
 * reserved `.example` domain and are never fetched. Returns stop().
 */
export function startCompetitorWatch(db: Db, key?: Buffer, fetchFn: Fetch = fetch, everyMs = 3_600_000) {
  let running = false;
  const check = async () => {
    if (running) return;
    running = true;
    try {
      const today = localDate();
      const done = JSON.parse(String(db.prepare("SELECT value_json FROM settings WHERE key = 'competitor_watch'").get()?.value_json ?? '{}')) as Record<string, string>;
      for (const c of db.prepare('SELECT id, url FROM competitors ORDER BY created_at').all()) {
        const [id, url] = [String(c.id), String(c.url)];
        if (done[id] === today || new URL(url).hostname.endsWith('.example')) continue;
        try {
          const changes = await watchCompetitorPrices(db, id, url, fetchFn, new Date(), key);
          log('info', 'competitor prices', { id, ...(changes === undefined ? { skipped: 'not a Shopify or WooCommerce store, or an Etsy shop with no Etsy store connected' } : { changes }) });
        } catch (e) {
          log('warn', 'competitor prices failed', { id, error: e instanceof Error ? e.message : String(e) });
        }
        done[id] = today;
        db.prepare("INSERT INTO settings (key, value_json) VALUES ('competitor_watch', ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(done));
      }
    } finally {
      running = false;
    }
  };
  void check();
  const timer = setInterval(() => void check(), everyMs);
  return () => clearInterval(timer);
}

export function competitorRoutes(db: Db, pickStores: (q?: string) => string[]) {
  const exists = (id: string) => !!db.prepare('SELECT 1 FROM competitors WHERE id = ?').get(id);
  const limitOf = (q: string | undefined, d: number) => Math.min(200, Math.max(1, Number(q) || d));
  return new Hono()
    .get('/api/competitors', (c) => c.json(listCompetitors(db, pickStores(c.req.query('stores')))))
    .get('/api/competitors/price-changes', (c) => c.json(priceChanges(db, pickStores(c.req.query('stores')), limitOf(c.req.query('limit'), 50))))
    .post('/api/competitors', async (c) => {
      const b = await c.req.json().catch(() => undefined);
      if (!isObj(b)) return c.json({ error: 'body must be a JSON object' }, 400);
      if (typeof b.storeId !== 'string' || !db.prepare('SELECT 1 FROM stores WHERE id = ?').get(b.storeId)) return c.json({ error: 'storeId must be an existing store' }, 400);
      if (!str(b.name, 80)) return c.json({ error: 'name must be 1-80 characters' }, 400);
      if (!httpUrl(b.url)) return c.json({ error: 'url must be an http(s) URL' }, 400);
      if (b.notes !== undefined && !str(b.notes, 2000)) return c.json({ error: 'notes must be 1-2000 characters' }, 400);
      const id = randomUUID();
      db.prepare('INSERT INTO competitors (id, store_id, name, url, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, b.storeId, b.name.trim(), String(b.url), (b.notes as string | undefined)?.trim() ?? null, new Date().toISOString());
      return c.json(listCompetitors(db, [b.storeId]).find((x) => x.id === id), 201);
    })
    .delete('/api/competitors/:id', (c) => (db.prepare('DELETE FROM competitors WHERE id = ?').run(c.req.param('id')).changes ? c.body(null, 204) : c.json({ error: 'competitor not found' }, 404)))
    .get('/api/competitors/:id/snapshots', (c) => {
      const id = c.req.param('id');
      if (!exists(id)) return c.json({ error: 'competitor not found' }, 404);
      const kind = c.req.query('kind');
      if (kind && kind !== 'price' && kind !== 'ad') return c.json({ error: 'kind must be price or ad' }, 400);
      const rows = db
        .prepare(`SELECT * FROM competitor_snapshots WHERE competitor_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY captured_at DESC, rowid DESC LIMIT ?`)
        .all(...(kind ? [id, kind] : [id]), limitOf(c.req.query('limit'), 50));
      return c.json(rows.map(toSnapshot));
    })
    .post('/api/competitors/:id/snapshots', async (c) => {
      const id = c.req.param('id');
      if (!exists(id)) return c.json({ error: 'competitor not found' }, 404);
      const b = await c.req.json().catch(() => undefined);
      const err = isObj(b) ? snapshotError(b.kind, b.data) : 'body must be a JSON object';
      if (err) return c.json({ error: err }, 400);
      return c.json(addSnapshot(db, id, b as Parameters<typeof addSnapshot>[2]), 201);
    });
}

// [storeId, name, slug, [product, base price][], ad angles [headline, body, cta][]]
const DEMO: [string, string, string, [string, number][], [string, string, string][]][] = [
  ['pawsome', 'Wag & Wander', 'wagandwander', [['Dog Car Seat Cover', 54.99], ['Travel Water Bottle', 21.99], ['Adventure Harness', 39.99]], [
    ['Road trips, minus the mess', 'Waterproof seat cover that installs in 30 seconds. 40% off today only.', 'Shop now'],
    ['Your dog deserves the window seat', 'Over 12,000 happy pups. Free shipping on orders $35+.', 'Learn more'],
  ]],
  ['pawsome', 'TrailPup Co', 'trailpup', [['Hiking Harness', 44.99], ['Collapsible Bowl Set', 16.99]], [
    ['Built for the trail', 'Reflective, no-pull, tested on 500 miles of trail. Lifetime warranty.', 'Shop now'],
  ]],
  ['glow', 'Lumi Skin Lab', 'lumiskinlab', [['LED Face Mask', 99.99], ['Ice Roller', 27.99], ['Microcurrent Wand', 79.99]], [
    ['Dermatologist results at home', 'Red light therapy in 10 minutes a day. 60-night money-back guarantee.', 'Shop now'],
    ['I tried it for 30 days…', 'Real customer, real routine. See the before & after.', 'Watch more'],
    ['Black Friday starts now', 'Our best-selling mask at the lowest price of the year.', 'Get offer'],
  ]],
  ['glow', 'DermaGlow Direct', 'dermaglow', [['Scalp Massager', 34.99], ['Facial Steamer', 49.99]], [
    ['Spa day, every day', 'The scalp massager 50k TikTokers swear by.', 'Shop now'],
  ]],
  ['peak', 'FlexNest', 'flexnest', [['Smart Jump Rope', 34.99], ['Resistance Bands', 29.99], ['Ab Roller', 31.99]], [
    ['Your gym fits in a drawer', 'Full-body workouts with 5 bands. Free app included.', 'Shop now'],
    ['Count every jump', 'The smart rope that syncs to your phone. Now with free shipping.', 'Learn more'],
  ]],
  ['peak', 'HomeGym Hero', 'homegymhero', [['Adjustable Kettlebell', 89.99], ['Massage Gun', 69.99]], [
    ['Replace 6 kettlebells with 1', 'Adjusts from 5 to 20 lb in a second. 4.8★ from 3,000 reviews.', 'Shop now'],
  ]],
];

/** Seeds demo competitors for the demo stores, once per data dir: 8 weeks of weekly price snapshots (with a few price moves) and recent ads. */
export function seedCompetitors(db: Db, today = localDate()) {
  if (!once(db, 'seed:competitors') || db.prepare('SELECT count(*) AS n FROM competitors').get()?.n) return;
  const demoIds = new Set(db.prepare('SELECT id FROM stores WHERE demo = 1').all().map((r) => String(r.id)));
  tx(db, () => {
    for (const [storeId, name, slug, products, ads] of DEMO) {
      if (!demoIds.has(storeId)) continue;
      const r = mulberry32(hash(slug));
      const id = `demo-${slug}`;
      db.prepare('INSERT INTO competitors (id, store_id, name, url, notes, created_at) VALUES (?, ?, ?, ?, NULL, ?)').run(id, storeId, name, `https://${slug}.example`, `${addDays(today, -60)}T12:00:00.000Z`);
      for (const [product, base] of products) {
        let price = base;
        for (let week = 8; week >= 0; week--) {
          if (r() < 0.2) price = Math.round(price * (r() < 0.6 ? 0.85 : 1.1)) - 0.01;
          addSnapshot(db, id, { kind: 'price', data: { product, price, compareAt: Math.round(base * 1.6) - 0.01 } }, `${addDays(today, -7 * week)}T09:00:00.000Z`);
        }
      }
      ads.forEach(([headline, body, cta], i) => {
        const firstSeen = addDays(today, -Math.floor(5 + r() * 40));
        const lastSeen = i === ads.length - 1 && ads.length > 1 ? addDays(today, -9) : addDays(today, -Math.floor(r() * 2));
        const network = (['meta', 'tiktok', 'meta'] as const)[i % 3]!;
        addSnapshot(db, id, { kind: 'ad', data: { network, format: network === 'tiktok' ? 'video' : i % 2 ? 'video' : 'image', headline, body, cta, firstSeen, lastSeen, landingUrl: `https://${slug}.example/` } }, `${lastSeen}T10:00:00.000Z`);
      });
    }
  });
}
