// SA-48/57: syncGa4 against the GA4 Data API's RunReportResponse shape
// (fixtures/ga4-doc-examples.json names the reference and the date read).
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { trafficMetrics } from '../store-analytics/traffic';
import { syncGa4 } from './google';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/ga4-doc-examples.json', import.meta.url), 'utf8'));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'contract-test@not-a-real-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });

describe('GA4 contract (SA-48)', () => {
  it("writes each reported day's sessions, add-to-carts and checkouts, never purchasing sessions", async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    saveIntegration(db, key, { kind: 'ga4', storeId: 'glow', values: { propertyId: '987654', serviceAccountJson: SA } });
    const bodies: string[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.not-a-real-token', expires_in: 3599, token_type: 'Bearer' });
      return Response.json(DOC.report);
    }) as typeof fetch;
    await syncGa4(db, key, 'glow', fetchFn, NOW);
    expect(JSON.parse(bodies[1]!)).toMatchObject({ dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'addToCarts' }, { name: 'checkouts' }] });
    // rows in any order land on their own day; the strings are numbers
    expect(db.prepare("SELECT date, sessions, add_to_carts, checkouts, purchase_sessions FROM daily_metrics WHERE store_id = 'glow' ORDER BY date").all()).toEqual([
      { date: '2026-10-23', sessions: 1188, add_to_carts: 91, checkouts: 38, purchase_sessions: null },
      { date: '2026-10-24', sessions: 1242, add_to_carts: 97, checkouts: 44, purchase_sessions: null },
      { date: '2026-10-25', sessions: 1310, add_to_carts: 104, checkouts: 47, purchase_sessions: null },
    ]);
    const t = trafficMetrics(db, 'glow', '2026-10-23', '2026-10-25');
    expect(t.sessions).toMatchObject({ value: 1188 + 1242 + 1310, status: 'ok' });
    expect(t.site_conversion).toMatchObject({ value: null, status: 'unavailable', reason: 'unsupported', note: 'GA4 sends event counts, not purchasing sessions.' });
  });

  it('SA-57: sessions by channel group, device and country per day; (not set) and any shortfall are unknown, purchasing sessions never', async () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    saveIntegration(db, key, { kind: 'ga4', storeId: 'glow', values: { propertyId: '987654', serviceAccountJson: SA } });
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'ya29.not-a-real-token', expires_in: 3599, token_type: 'Bearer' });
      const dims = (JSON.parse(String(init.body)) as { dimensions: { name: string }[] }).dimensions.map((x) => x.name);
      if (dims[1] === 'countryId') return Response.json({ error: { code: 429, message: 'Exhausted property tokens', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 });
      return Response.json(dims[1] ? DOC.breakdowns[dims[1]] : DOC.report);
    }) as typeof fetch;
    await syncGa4(db, key, 'glow', fetchFn, NOW);
    const rows = (dimension: string) =>
      db.prepare("SELECT date, value, sessions, purchase_sessions AS ps, source FROM traffic_breakdown_daily WHERE store_id = 'glow' AND dimension = ? AND date = '2026-10-25' ORDER BY value").all(dimension);
    expect(rows('source')).toEqual([
      { date: '2026-10-25', value: 'Direct', sessions: 400, ps: null, source: 'ga4' },
      { date: '2026-10-25', value: 'Organic Search', sessions: 600, ps: null, source: 'ga4' },
      { date: '2026-10-25', value: 'Paid Social', sessions: 300, ps: null, source: 'ga4' },
      { date: '2026-10-25', value: 'unknown', sessions: 10, ps: null, source: 'ga4' }, // the (not set) sessions
    ]);
    expect(rows('device').map((r) => [r.value, r.sessions])).toEqual([['desktop', 500], ['mobile', 760], ['tablet', 50]]); // adds up: no unknown
    expect(db.prepare("SELECT value, sessions FROM traffic_breakdown_daily WHERE store_id = 'glow' AND dimension = 'device' AND date = '2026-10-24'").all()).toEqual([{ value: 'unknown', sessions: 1242 }]);
    expect(rows('country')).toEqual([]); // that split failed: nothing written, the read marked partial
    expect(db.prepare("SELECT dataset, status FROM source_datasets WHERE integration_id = 'ga4:glow' ORDER BY dataset").all()).toEqual([
      { dataset: 'traffic', status: 'available' },
      { dataset: 'traffic_breakdowns', status: 'partial' },
    ]);
    expect(db.prepare("SELECT status FROM integrations WHERE id = 'ga4:glow'").get()).toEqual({ status: 'connected' });
  });
});
