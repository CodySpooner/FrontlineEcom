// SA-10: every syncer run is logged in sync_runs; errors leave scrubbed.
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration, setIntegrationStatus } from '../integrations';
import { startSyncLoop } from '../sync';
import { scrubError } from './sources';

afterEach(() => vi.useRealTimers());

// Not a real token's format (secret scanners match those): long enough to be token-shaped.
const TOKEN = 'tok_not-a-real-secret-not-a-real-secret';
const setup = () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const key = randomBytes(32);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'glow', values: { shopDomain: 'glow.myshopify.com', accessToken: TOKEN } });
  return { db, key };
};
const runs = (db: ReturnType<typeof openDb>) => db.prepare('SELECT integration_id, store_id, kind, status, error, started_at, finished_at FROM sync_runs ORDER BY id').all();

describe('sync-run log', () => {
  it('records a successful run as done', async () => {
    const { db, key } = setup();
    const stop = startSyncLoop(db, key, { syncers: { shopify: async () => setIntegrationStatus(db, 'shopify:glow', 'connected') } });
    expect(runs(db)).toMatchObject([{ status: 'running', finished_at: null }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runs(db)).toEqual([{ integration_id: 'shopify:glow', store_id: 'glow', kind: 'shopify', status: 'done', error: null, started_at: '2026-10-26T12:00:00.000Z', finished_at: '2026-10-26T12:00:00.000Z' }]);
    stop();
  });

  it('records a failure with the error scrubbed of the token, whether reported or thrown', async () => {
    const { db, key } = setup();
    let n = 0;
    const shopify = async () => {
      if (n++ === 0) setIntegrationStatus(db, 'shopify:glow', 'error', `Shopify refused the token for https://glow.myshopify.com/admin?t=${TOKEN}`);
      else throw new Error(`fetch failed: Authorization: Bearer ${TOKEN}`);
    };
    const stop = startSyncLoop(db, key, { everyMs: 1000, staleMs: 60_000, fastMs: 60_000, syncers: { shopify } });
    await vi.advanceTimersByTimeAsync(61_000);
    const [reported, thrown] = runs(db);
    expect(reported).toMatchObject({ status: 'failed', error: 'Shopify refused the token for https://glow.myshopify.com/admin?t=[hidden]' });
    expect(thrown).toMatchObject({ status: 'failed', error: 'fetch failed: Authorization: Bearer [hidden]' });
    expect(JSON.stringify(runs(db))).not.toContain(TOKEN);
    stop();
  });

  it('marks a run left running by the last process as interrupted, and drops runs over 90 days old, at start', () => {
    const { db, key } = setup();
    const add = db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, status) VALUES ('shopify:glow', 'glow', 'shopify', ?, ?)");
    add.run('2026-10-26T11:58:00.000Z', 'running');
    add.run('2026-07-27T11:00:00.000Z', 'done'); // 91 days
    add.run('2026-07-29T11:00:00.000Z', 'done');
    const stop = startSyncLoop(db, key, { syncers: {} });
    expect(runs(db).map((r) => [r.started_at, r.status])).toEqual([['2026-10-26T11:58:00.000Z', 'interrupted'], ['2026-07-29T11:00:00.000Z', 'done']]);
    stop();
  });
});

describe('scrubError', () => {
  it('removes credential values (plain and URL-encoded) and token-shaped strings, and cuts to 300 characters', () => {
    expect(scrubError('key=a b/c+d&x=1 then a%20b%2Fc%2Bd', ['a b/c+d'])).toBe('key=[hidden]&x=1 then [hidden]');
    expect(scrubError('JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig_part done')).toBe('JWT [hidden] done');
    // ordinary paths and ids stay readable
    expect(scrubError('GET /admin/api/2025-01/orders.json?since_id=5770001 returned 503')).toBe('GET /admin/api/2025-01/orders.json?since_id=5770001 returned 503');
    expect(scrubError('x'.repeat(10) + ' ' + 'y '.repeat(400))).toHaveLength(300);
  });
});
