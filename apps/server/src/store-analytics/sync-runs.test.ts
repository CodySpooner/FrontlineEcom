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

describe('bounded backoff (SA-11)', () => {
  const MIN = 60_000;
  const loop = (db: ReturnType<typeof openDb>, key: Buffer, fail: () => boolean) => {
    const shopify = vi.fn(async () => setIntegrationStatus(db, 'shopify:glow', fail() ? 'error' : 'connected', fail() ? 'Shopify is down' : undefined));
    return { shopify, stop: startSyncLoop(db, key, { everyMs: 1000, staleMs: MIN, fastMs: MIN, syncers: { shopify } }) };
  };

  it('waits 30 minutes after 3 failures in a row and 6 hours after 6, never retrying sooner', async () => {
    const { db, key } = setup();
    const { shopify, stop } = loop(db, key, () => true);
    await vi.advanceTimersByTimeAsync(2 * 61_000); // failures 2 and 3, the last at 2:02
    expect(shopify).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * MIN - 2000);
    expect(shopify).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(shopify).toHaveBeenCalledTimes(4); // 30 minutes after the third: fails again, waits 30 more
    await vi.advanceTimersByTimeAsync(2 * (30 * MIN + 1000));
    expect(shopify).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(6 * 60 * MIN - 3000); // the sixth failed at 13:32:02; now 19:32:01
    expect(shopify).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(2000);
    expect(shopify).toHaveBeenCalledTimes(7);
    stop();
  });

  it('runs at once on "Sync now" or new credentials while backed off, and one success resets the count', async () => {
    const { db, key } = setup();
    let failing = true;
    const { shopify, stop } = loop(db, key, () => failing);
    await vi.advanceTimersByTimeAsync(2 * 61_000);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(shopify).toHaveBeenCalledTimes(3);
    failing = false;
    db.prepare("UPDATE integrations SET updated_at = ? WHERE id = 'shopify:glow'").run(new Date().toISOString()); // what POST /sync does
    await vi.advanceTimersByTimeAsync(1000);
    expect(shopify).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(61_000); // back on the normal interval
    expect(shopify).toHaveBeenCalledTimes(5);
    stop();
  });

  it('keeps waiting across a restart', async () => {
    const { db, key } = setup();
    const add = db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, finished_at, status) VALUES ('shopify:glow', 'glow', 'shopify', ?, ?, 'failed')");
    for (const at of ['11:40', '11:50', '11:55']) add.run(`2026-10-26T${at}:00.000Z`, `2026-10-26T${at}:05.000Z`);
    db.prepare("UPDATE integrations SET updated_at = '2026-10-26T11:00:00.000Z'").run(); // saved before the failures
    const { shopify, stop } = loop(db, key, () => true);
    await vi.advanceTimersByTimeAsync(0);
    expect(shopify).not.toHaveBeenCalled(); // 12:00, waiting until 12:25:05
    await vi.advanceTimersByTimeAsync(26 * MIN);
    expect(shopify).toHaveBeenCalledTimes(1);
    stop();
  });
});
