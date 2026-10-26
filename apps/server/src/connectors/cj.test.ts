import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { getCredentials, saveIntegration } from '../integrations';
import { syncCj } from './cj';

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
