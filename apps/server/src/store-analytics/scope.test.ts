// SA-13: every /api/analytics route is scoped to one store (decision 3). Later items add their routes to ROUTES; the
// sweep fails while any route under /api/analytics/ has no row.
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db, '2026-10-26');
  app = createApp(db);
});

type Row = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** The legacy Dashboard routes (decision 31): they keep pickStores and aren't swept for scope. */
  legacy?: true;
  /** For a route with a record id: one of pawsome's, made here; asked for with store=glow it must be 404. */
  record?: (db: Db) => string;
  /** A write's body (the record id goes in it); the scope fields (store, stores) are added from the case. */
  body?: (id: string) => Record<string, unknown>;
};
const pawsomeShopify = (db: Db) => {
  db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES ('shopify:pawsome', 'shopify', 'pawsome', 'connected', '{\"shopDomain\":\"pawsome.myshopify.com\"}', '', '2026-10-26')").run();
  return 'shopify:pawsome';
};
const ROUTES: Row[] = [
  { method: 'GET', path: '/api/analytics/summary', legacy: true },
  { method: 'GET', path: '/api/analytics/campaigns', legacy: true },
  { method: 'GET', path: '/api/analytics/top-products', legacy: true },
  { method: 'GET', path: '/api/analytics/definitions' },
  { method: 'GET', path: '/api/analytics/context' },
  { method: 'GET', path: '/api/analytics/sources' },
  { method: 'GET', path: '/api/analytics/metrics' },
  { method: 'PUT', path: '/api/analytics/sources/verified', record: pawsomeShopify, body: (id) => ({ integration: id, dataset: 'orders', note: 'Matched the platform report' }) },
];

const send = (r: Row, query: string, id = 'x') =>
  r.method === 'GET'
    ? app.request(`${r.path.replace(/:\w+/, id)}${query}`)
    : app.request(r.path.replace(/:\w+/, id), {
        method: r.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...r.body?.(id), ...Object.fromEntries(new URLSearchParams(query.slice(1))) }),
      });

describe('store scope', () => {
  it('every /api/analytics route has a row here', () => {
    const mounted = [...new Set(app.routes.filter((r) => r.path.startsWith('/api/analytics/') && r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
    expect(mounted.sort()).toEqual(ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });

  for (const r of ROUTES.filter((r) => !r.legacy)) {
    it(`${r.method} ${r.path}: no store 400, unknown store 404, a stores= list 400, unknown metric 400`, async () => {
      const id = r.record?.(db);
      expect((await send(r, '', id)).status).toBe(400);
      expect((await send(r, '?store=nope', id)).status).toBe(404);
      expect((await send(r, '?stores=glow,peak', id)).status).toBe(400);
      if (r.method === 'GET') expect((await send(r, '?store=glow&metrics=net_sales,profit', id)).status).toBe(400);
      if (id) expect((await send(r, '?store=glow', id)).status).toBe(404); // pawsome's record
    });
  }
});

describe('GET /api/analytics/definitions', () => {
  it('returns the metric registry and the sources, narrowed to metrics= when given', async () => {
    const all = (await (await app.request('/api/analytics/definitions?store=glow')).json()) as { metrics: Record<string, { version: number }>; sources: Record<string, unknown> };
    expect(all.metrics.net_sales).toMatchObject({ id: 'net_sales', version: 1 });
    expect(Object.keys(all.sources)).toContain('shopify');
    const some = (await (await app.request('/api/analytics/definitions?store=glow&metrics=net_sales,aov')).json()) as { metrics: Record<string, unknown> };
    expect(Object.keys(some.metrics)).toEqual(['net_sales', 'aov']);
  });

  it('refuses writes over the size limit like the other guarded routes', async () => {
    const res = await app.request('/api/analytics/definitions?store=glow', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(413);
  });
});
