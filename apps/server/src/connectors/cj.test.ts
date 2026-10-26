import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { SupplierProduct } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { getCredentials, saveIntegration } from '../integrations';
import { seedResearch } from '../research';
import { searchCj, syncCj } from './cj';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');

const cjOrder = (orderNum: string, orderStatus: string, trackNumber: string | null = null, shopName = 'Glow Haus') => ({ orderNum, shopName, orderStatus, trackNumber });

/** Fake CJ: token endpoint + order list per status (two pages of SHIPPED). */
function fakeCj(byStatus: Record<string, ReturnType<typeof cjOrder>[]>, tokenResult = true) {
  const calls: { url: URL; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (u.pathname.endsWith('/getAccessToken')) {
      return Response.json(tokenResult ? { code: 200, result: true, message: 'Success', data: { accessToken: 'cj-access', accessTokenExpiryDate: '2026-11-10T09:16:33+08:00' } } : { code: 1601000, result: false, message: 'User not find', data: null });
    }
    const all = byStatus[u.searchParams.get('status')!] ?? [];
    const page = Number(u.searchParams.get('pageNum'));
    const size = Number(u.searchParams.get('pageSize'));
    return Response.json({ code: 200, result: true, message: 'Success', data: { pageNum: page, pageSize: size, total: all.length, list: all.slice((page - 1) * size, page * size) } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare('UPDATE stores SET demo = 0').run(); // connected stores: CJ only touches real orders
  saveIntegration(db, key, { kind: 'cj', values: { email: 'owner@example.com', apiKey: 'CJ-KEY' } });
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, tracking, cogs, local_date) VALUES (?, ?, '2026-10-20T10:00:00Z', 40, 'paid', ?, ?, 0, '2026-10-20')");
  order.run('glow', '#2001', 'unfulfilled', null);
  order.run('glow', '#2002', 'delivered', null);
  order.run('glow', 'tt-5761', 'unfulfilled', null);
  order.run('glow', '#3001', 'unfulfilled', null);
  order.run('peak', '#3001', 'unfulfilled', null); // same number in another store
  order.run('peak', '#3002', 'unfulfilled', 'OLD');
  order.run('pawsome', '#3002', 'unfulfilled', null);
  return db;
};

test('CJ sync fills supplier, tracking and shipping status on the matching store orders', async () => {
  const db = setup();
  const shipped = [cjOrder('2001', 'SHIPPED', 'CJPKL7'), cjOrder('#2002', 'SHIPPED', 'CJPKL8'), cjOrder('5761', 'SHIPPED', 'CJPKL9'), ...Array.from({ length: 20 }, (_, i) => cjOrder(`9${i}`, 'SHIPPED'))];
  const { fetchFn, calls } = fakeCj({ SHIPPED: shipped, UNSHIPPED: [cjOrder('3001', 'UNSHIPPED', null, 'Glow Haus'), cjOrder('3002', 'UNSHIPPED', null, 'Unknown shop')] });
  await syncCj(db, key, 'null', fetchFn, NOW, 0);

  expect(JSON.parse(calls[0]!.body)).toEqual({ apiKey: 'CJ-KEY' });
  const lists = calls.slice(1);
  expect(lists.every((c) => c.headers.get('CJ-Access-Token') === 'cj-access')).toBe(true);
  expect(lists.map((c) => `${c.url.searchParams.get('status')}:${c.url.searchParams.get('pageNum')}`)).toEqual(['UNSHIPPED:1', 'SHIPPED:1', 'SHIPPED:2', 'DELIVERED:1']);
  expect(Object.fromEntries(lists[0]!.url.searchParams)).toMatchObject({ paymentDateFrom: '2026-09-26 18:00:00', paymentDateTo: '2026-10-26 18:00:00' });

  const rows = db.prepare("SELECT store_id, id, fulfillment_status AS f, supplier, tracking FROM orders WHERE id IN ('#2001', '#2002', 'tt-5761', '#3001', '#3002') ORDER BY store_id, id").all();
  expect(rows.map((r) => ({ ...r }))).toEqual([
    { store_id: 'glow', id: '#2001', f: 'in_transit', supplier: 'CJ Dropshipping', tracking: 'CJPKL7' },
    { store_id: 'glow', id: '#2002', f: 'delivered', supplier: 'CJ Dropshipping', tracking: 'CJPKL8' }, // never moves backwards
    { store_id: 'glow', id: '#3001', f: 'unfulfilled', supplier: 'CJ Dropshipping', tracking: null }, // CJ shop name picked glow
    { store_id: 'glow', id: 'tt-5761', f: 'in_transit', supplier: 'CJ Dropshipping', tracking: 'CJPKL9' },
    { store_id: 'pawsome', id: '#3002', f: 'unfulfilled', supplier: null, tracking: null }, // ambiguous, skipped
    { store_id: 'peak', id: '#3001', f: 'unfulfilled', supplier: null, tracking: null },
    { store_id: 'peak', id: '#3002', f: 'unfulfilled', supplier: null, tracking: 'OLD' },
  ]);
  expect(db.prepare("SELECT status, synced_at FROM integrations WHERE id = 'cj:global'").get()).toEqual({ status: 'connected', synced_at: NOW.toISOString() });

  // The token is cached until a day before it expires.
  expect(getCredentials(db, key, 'cj')).toMatchObject({ accessToken: 'cj-access', accessTokenExpiresAt: String(Date.parse('2026-11-10T09:16:33+08:00') / 1000) });
  const again = fakeCj({});
  await syncCj(db, key, 'null', again.fetchFn, NOW, 0);
  expect(again.calls.some((c) => c.url.pathname.endsWith('/getAccessToken'))).toBe(false);
});

test('CJ: a bad API key shows a clear error', async () => {
  const db = setup();
  await syncCj(db, key, 'null', fakeCj({}, false).fetchFn, NOW, 0);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'cj:global'").get()).toEqual({ status: 'error', error: 'CJ: User not find' });
});

test('CJ catalog search maps products (lowest variant price); without CJ the route serves demo matches', async () => {
  const db = setup();
  const calls: URL[] = [];
  const fetchFn = (async (url: string) => {
    const u = new URL(url);
    calls.push(u);
    if (u.pathname.endsWith('/getAccessToken')) return Response.json({ code: 200, result: true, message: 'Success', data: { accessToken: 'cj-access', accessTokenExpiryDate: '2026-11-10T09:16:33+08:00' } });
    return Response.json({ code: 200, result: true, message: 'Success', data: { content: [{ productList: [
      { id: '1A2B', sku: 'CJYD1001', nameEn: 'Ice Roller', bigImage: 'https://cf.cjdropshipping.com/roller.jpg', sellPrice: '2.47 -- 3.10', listedNum: 812 },
      { id: '3C4D', sku: 'CJYD1002', nameEn: 'Ice Roller Mini', sellPrice: 1.9 },
    ] }] } });
  }) as typeof fetch;
  expect(await searchCj(db, key, 'ice roller', 10, fetchFn, NOW, 0)).toEqual([
    { supplier: 'cj', id: '1A2B', sku: 'CJYD1001', title: 'Ice Roller', image: 'https://cf.cjdropshipping.com/roller.jpg', price: 2.47, listed: 812 },
    { supplier: 'cj', id: '3C4D', sku: 'CJYD1002', title: 'Ice Roller Mini', price: 1.9, listed: 0 },
  ]);
  expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({ keyWord: 'ice roller', page: '1', size: '10' });

  const demoDb = openDb();
  seedDemo(demoDb, '2026-10-26');
  seedResearch(demoDb);
  expect(await searchCj(demoDb, key, 'x', 5)).toBeUndefined();
  const title = String(demoDb.prepare('SELECT title FROM research_products LIMIT 1').get()!.title);
  const app = createApp(demoDb);
  const res = (await (await app.request(`/api/suppliers/products?q=${encodeURIComponent(title.split(' ')[0]!)}&limit=3`)).json()) as SupplierProduct[];
  expect(res.length).toBeGreaterThan(0);
  expect(res.length).toBeLessThanOrEqual(3);
  expect(res.every((p) => p.demo && p.price > 0 && p.title.toLowerCase().includes(title.split(' ')[0]!.toLowerCase()))).toBe(true);
  expect((await app.request('/api/suppliers/products?q=')).status).toBe(400);
});

test('CJ calls take turns (one per second for real), so two searches at once are not rate limited', async () => {
  const db = setup();
  const at: number[] = [];
  const fetchFn = (async (url: string) => {
    at.push(Date.now());
    if (url.endsWith('/getAccessToken')) return Response.json({ code: 200, result: true, message: 'Success', data: { accessToken: 'cj-access', accessTokenExpiryDate: '2026-11-10T09:16:33+08:00' } });
    return Response.json({ code: 200, result: true, message: 'Success', data: { content: [] } });
  }) as typeof fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    const both = Promise.all([searchCj(db, key, 'roller', 5, fetchFn, NOW), searchCj(db, key, 'mask', 5, fetchFn, NOW)]);
    await vi.advanceTimersByTimeAsync(5000);
    await both;
  } finally {
    vi.useRealTimers();
  }
  expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([1100, 1100, 1100]);
});

test("CJ leaves demo stores out: a real order whose number a demo store also has (they count from #1001 too) still gets its tracking", async () => {
  const db = setup();
  db.prepare("UPDATE stores SET demo = 1 WHERE id = 'peak'").run();
  const { fetchFn } = fakeCj({ SHIPPED: [cjOrder('3001', 'SHIPPED', 'CJPKL1', 'Glow Haus Official')] });
  await syncCj(db, key, 'null', fetchFn, NOW, 0);
  expect(db.prepare("SELECT store_id, tracking FROM orders WHERE id = '#3001' ORDER BY store_id").all().map((r) => ({ ...r }))).toEqual([
    { store_id: 'glow', tracking: 'CJPKL1' },
    { store_id: 'peak', tracking: null },
  ]);
});
