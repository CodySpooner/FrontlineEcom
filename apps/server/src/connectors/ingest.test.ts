// SA-12: per-dataset read outcomes, against recorded-shape responses.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { localDate } from '../dates';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { syncAmazon } from './amazon';
import { noteRead } from './ingest';
import { syncShopify } from './shopify';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
// Not a real token's format (secret scanners match those).
const TOKEN = 'tok_not-a-real-secret-not-a-real-secret';
const datasets = (db: ReturnType<typeof openDb>, integration: string) =>
  Object.fromEntries(
    db.prepare('SELECT dataset, store_id, status, last_try_at, last_success_at, error, covered_from, covered_to FROM source_datasets WHERE integration_id = ?').all(integration).map((r) => [r.dataset, r]),
  );

describe('noteRead', () => {
  it('widens the covered days on success and keeps the last success through a failure', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } });
    noteRead(db, key, 'shopify:glow', 'orders', { status: 'available', from: '2024-10-27', to: '2026-10-26' }, new Date('2026-10-26T12:00:00Z'));
    noteRead(db, key, 'shopify:glow', 'orders', { status: 'available', from: '2026-10-26', to: '2026-10-27' }, new Date('2026-10-27T12:00:00Z'));
    noteRead(db, key, 'shopify:glow', 'orders', { status: 'failed', error: `401 for ${TOKEN}` }, new Date('2026-10-27T13:00:00Z'));
    expect(datasets(db, 'shopify:glow').orders).toEqual({
      dataset: 'orders', store_id: 'glow', status: 'failed', last_try_at: '2026-10-27T13:00:00.000Z', last_success_at: '2026-10-27T12:00:00.000Z',
      error: '401 for [hidden]', covered_from: '2024-10-27', covered_to: '2026-10-27',
    });
  });
});

describe('connector read outcomes', () => {
  it('a Shopify funnel error marks traffic failed with a scrubbed message; orders and the catalog stay available', async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow-haus.myshopify.com', accessToken: TOKEN } });
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      const json = (data: unknown) => Response.json({ data });
      if (body.query.includes('shop {')) return json({ shop: { name: 'Glow Haus', currencyCode: 'USD', ianaTimezone: 'America/New_York' } });
      if (body.query.includes('products(')) return json({ products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
      if (body.query.includes('shopifyqlQuery')) return Response.json({ errors: [{ message: `Access denied for shopifyqlQuery field (token ${TOKEN} lacks read_reports).` }] });
      return json({ orders: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } });
    }) as typeof fetch;
    await syncShopify(db, key, 'glow', fetchFn, NOW);
    expect(db.prepare("SELECT status FROM integrations WHERE id = 'shopify:glow'").get()?.status).toBe('connected');
    const d = datasets(db, 'shopify:glow');
    expect(d.traffic).toMatchObject({ status: 'failed', last_success_at: null });
    expect(String(d.traffic!.error)).toContain('Access denied for shopifyqlQuery field');
    expect(String(d.traffic!.error)).not.toContain(TOKEN);
    expect(d.orders).toMatchObject({ status: 'available', error: null, covered_to: localDate(NOW) });
    expect(d.catalog).toMatchObject({ status: 'available', error: null });
  });

  it('a failed Amazon traffic read marks traffic failed while orders stay available', async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
    saveIntegration(db, key, { kind: 'amazon', storeId: 'peak', values: { sellerId: 'A1SELLER', region: 'na', marketplaceId: 'ATVPDKIKX0DER', clientId: 'amzn1.application-oa2-client.x', clientSecret: 'lwa_secret', refreshToken: 'Atzr|fixture' } });
    const fetchFn = (async (url: string) => {
      const u = new URL(url);
      if (u.host === 'api.amazon.com') return Response.json({ access_token: 'Atza|access', expires_in: 3600 });
      if (u.pathname === '/reports/2021-06-30/reports') return Response.json({ reportId: 'R1' }, { status: 202 });
      if (u.pathname === '/reports/2021-06-30/reports/R1') return Response.json({ errors: [{ code: 'InternalFailure', message: 'We encountered an internal error.' }] }, { status: 500 });
      if (u.pathname.startsWith('/listings/')) return Response.json({ items: [] });
      if (u.pathname === '/sales/v1/orderMetrics') return Response.json({ payload: [{ interval: '2026-10-26T00:00-07:00--x', orderCount: 2, totalSales: { amount: 80, currencyCode: 'USD' } }] });
      return Response.json({}); // FBA, orders, finances: nothing new
    }) as typeof fetch;
    await syncAmazon(db, key, 'peak', fetchFn, NOW); // asks for the report: traffic not tried yet
    expect(datasets(db, 'amazon:peak').traffic).toBeUndefined();
    await syncAmazon(db, key, 'peak', fetchFn, NOW);
    const d = datasets(db, 'amazon:peak');
    expect(d.traffic).toMatchObject({ status: 'failed', error: 'Amazon reports: We encountered an internal error.' });
    expect(d.orders).toMatchObject({ status: 'available', error: null });
  });
});
