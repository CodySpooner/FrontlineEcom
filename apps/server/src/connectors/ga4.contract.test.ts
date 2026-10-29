// SA-48: the existing syncGa4 (google.ts, unchanged) against the GA4 Data API's RunReportResponse shape
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
});
