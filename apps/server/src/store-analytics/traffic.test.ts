// SA-21: sessions and site conversion beyond the oracle.
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { trafficMetrics } from './traffic';

const { P1 } = LEDGER_PERIODS;

describe('trafficMetrics', () => {
  it('a GA4 store keeps its sessions but has no conversion, with the reason', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES ('ga4:ledger', 'ga4', 'ledger', 'connected', '{}', '', '2026-11-09')").run();
    const m = trafficMetrics(db, LEDGER_STORE, P1.from, P1.to);
    expect(m.sessions.value).toBe(700);
    expect(m.site_conversion).toEqual({ value: null, status: 'unavailable', reason: 'unsupported', note: 'GA4 sends event counts, not purchasing sessions.' });
  });

  it('a Shopify store whose purchasing sessions were never read is needs_ingestion, not 0%', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE daily_metrics SET purchase_sessions = NULL WHERE store_id = 'ledger'").run();
    expect(trafficMetrics(db, LEDGER_STORE, P1.from, P1.to).site_conversion).toMatchObject({ value: null, reason: 'needs_ingestion' });
  });

  it("days with no sessions report are left out and counted; a read's covered zero day counts as 0", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("UPDATE daily_metrics SET sessions = 0 WHERE store_id = 'ledger' AND date IN ('2026-10-28', '2026-10-29')").run();
    expect(trafficMetrics(db, LEDGER_STORE, P1.from, P1.to).sessions).toMatchObject({ value: 500, status: 'partial', coverage: { share: 5 / 7, of: 'days' } });
    db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_success_at, covered_from, covered_to) VALUES ('shopify:ledger', 'traffic', 'ledger', 'available', '2026-11-09T16:55:00Z', '2026-10-01', '2026-11-08')").run();
    expect(trafficMetrics(db, LEDGER_STORE, P1.from, P1.to).sessions).toMatchObject({ value: 500, status: 'ok' });
  });

  it("an Etsy store: no traffic read is the dataset's reason; conversion isn't supported", () => {
    const db = openDb();
    insertStore(db, { id: 'etsy1', name: 'Etsy Shop', platform: 'etsy', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    const m = trafficMetrics(db, 'etsy1', P1.from, P1.to);
    expect(m.sessions).toMatchObject({ value: null, status: 'unavailable' });
    expect(m.sessions.reason).toBeDefined();
    expect(m.site_conversion).toMatchObject({ value: null, reason: 'unsupported' });
  });

  it('demo stores read demoDay: every value demo', () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const m = trafficMetrics(db, 'glow', '2026-10-19', '2026-10-25');
    expect(m.sessions.status).toBe('demo');
    expect(m.site_conversion.status).toBe('demo');
    expect(m.site_conversion.value).toBeGreaterThan(0);
    expect(m.site_conversion.value).toBeLessThan(0.1);
  });
});
