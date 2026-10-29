// SA-14: dataset freshness, the Data sources rows and the store context.
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { LEDGER_NOW, LEDGER_STORE, seedLedgerStore } from './fixture';
import { storeContext } from './routes';
import { sourceRows } from './sources';

const MIN = 60_000;

describe('sources', () => {
  it('a store with no integrations gets its platform\'s rows as needs_credentials, with a fix link, never an empty list', () => {
    const db = openDb();
    insertStore(db, { id: 'bare', name: 'Bare Shop', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: false });
    const rows = sourceRows(db, 'bare');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['shopify']));
    expect(rows.find((r) => r.dataset === 'orders')).toMatchObject({
      status: 'needs_credentials', reason: 'needs_credentials', lastSuccess: null, stale: false, fix: { label: 'Connect Shopify', href: '/settings/integrations?store=bare' },
    });
    expect(rows.some((r) => r.status === 'available' || r.status === 'verified')).toBe(false);
  });

  it('a demo store reads demo (or unsupported) everywhere', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const rows = sourceRows(db, 'glow');
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(['demo']));
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['demo', 'unsupported']));
    expect(rows.find((r) => r.dataset === 'customers')?.status).toBe('unsupported');
  });

  it("a connected store: what was read, what wasn't synced yet, a stale dataset, a failure with its backoff", () => {
    const db = openDb();
    seedLedgerStore(db); // TikTok Shop's orders read 16:55; nothing else noted yet
    const row = (source: string, dataset: string, now = LEDGER_NOW) => sourceRows(db, LEDGER_STORE, now).find((r) => r.source === source && r.dataset === dataset);
    expect(row('tiktok_shop', 'orders')).toMatchObject({ status: 'available', stale: false, coveredFrom: '2026-10-24', coveredTo: '2026-11-08' });
    expect(row('tiktok_shop', 'orders')!.fix).toBeUndefined();
    expect(row('shopify', 'orders')).toMatchObject({ status: 'not_tracked', reason: 'needs_ingestion' });
    expect(row('shopify', 'order_lines')).toMatchObject({ status: 'not_tracked', reason: 'not_tracked' }); // not read yet (SA-30)
    expect(row('shopify', 'customers')?.status).not.toBe('available');
    // 35 minutes later TikTok Shop (a 10-minute source) has had no success for over 3 intervals
    expect(row('tiktok_shop', 'orders', LEDGER_NOW + 35 * MIN)).toMatchObject({ status: 'available', stale: true, fix: { label: 'Check TikTok Shop' } });

    const run = db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, finished_at, status, error) VALUES ('meta_ads:ledger', 'ledger', 'meta_ads', ?, ?, 'failed', 'Meta: (#17) User request limit reached')");
    for (const at of ['16:30', '16:40', '16:50']) run.run(`2026-11-09T${at}:00.000Z`, `2026-11-09T${at}:02.000Z`);
    db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, error) VALUES ('meta_ads:ledger', 'ad_spend', 'ledger', 'failed', '2026-11-09T16:50:02.000Z', 'Meta: (#17) User request limit reached')").run();
    expect(row('meta_ads', 'ad_spend')).toMatchObject({ status: 'failed', error: 'Meta: (#17) User request limit reached', backoffUntil: '2026-11-09T17:20:02.000Z', fix: { label: 'Check Meta Ads' } });
    expect(row('meta_ads', 'attribution')).toMatchObject({ status: 'not_tracked', reason: 'needs_ingestion', backoffUntil: '2026-11-09T17:20:02.000Z' });
  });
});

describe('context', () => {
  it("names the store, its channels, zone, currency and history; a demo store says it's demo", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    seedLedgerStore(db);
    expect(storeContext(db, LEDGER_STORE, LEDGER_NOW)).toMatchObject({
      storeId: 'ledger', name: 'Ledger Test Store', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false,
      channels: [{ kind: 'meta_ads', name: 'Meta Ads', status: 'connected' }, { kind: 'shopify', name: 'Shopify', status: 'connected' }, { kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }],
      zone: 'America/New_York', zoneLabel: 'America/New_York', zoneAbbr: 'ET', historyStart: '2026-10-19',
    });
    const glow = storeContext(db, 'glow');
    expect(glow).toMatchObject({ demo: true, channels: [], zone: null, zoneLabel: "This computer's time (demo data)" });
    expect(glow.freshness.every((f) => f.source === 'demo')).toBe(true);
  });

  it('serves context and sources over the API', async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const app = createApp(db);
    expect(await (await app.request('/api/analytics/context?store=glow')).json()).toMatchObject({ storeId: 'glow', demo: true });
    expect(((await (await app.request('/api/analytics/sources?store=glow')).json()) as unknown[]).length).toBeGreaterThan(0);
  });
});
