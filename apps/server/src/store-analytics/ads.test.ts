// SA-20: ad spend, platform ROAS and contribution after ads beyond the oracle.
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { adMetrics } from './ads';
import { LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const { P1 } = LEDGER_PERIODS;

describe('adMetrics', () => {
  it('no ad integration is needs_credentials, never $0, and contribution after ads follows', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("DELETE FROM integrations WHERE id = 'meta_ads:ledger'").run();
    db.prepare("DELETE FROM campaigns WHERE store_id = 'ledger'").run();
    const { values } = adMetrics(db, LEDGER_STORE, P1.from, P1.to);
    for (const id of ['ad_spend', 'platform_roas', 'contribution_after_ads'] as const)
      expect(values[id], id).toMatchObject({ value: null, status: 'unavailable', reason: 'needs_credentials' });
    expect(values.ad_spend.fix).toEqual({ label: 'Connect an ad network', href: '/settings/integrations?store=ledger' });
  });

  it("a connected network that hasn't synced is needs_ingestion; a second one makes the rest partial", () => {
    const db = openDb();
    insertStore(db, { id: 'fresh', name: 'Fresh Shop', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    const integ = db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at, synced_at) VALUES (?, ?, 'fresh', 'connected', '{}', '', '2026-11-09', ?)");
    integ.run('google_ads:fresh', 'google_ads', null);
    expect(adMetrics(db, 'fresh', P1.from, P1.to).values.ad_spend).toMatchObject({ value: null, reason: 'needs_ingestion', note: 'Not synced yet: Google Ads' });
    integ.run('meta_ads:fresh', 'meta_ads', '2026-11-09T16:55:00Z');
    // Meta synced and spent nothing: a real $0, partial while Google hasn't synced.
    expect(adMetrics(db, 'fresh', P1.from, P1.to).values.ad_spend).toMatchObject({ value: 0, status: 'partial', note: 'Not synced yet: Google Ads' });
  });

  it('two networks keep their own ROAS: the store figure is never combined', () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('tiktok', 't1', 'ledger', 'Spark Ads', 'active', 10)").run();
    db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('tiktok', 't1', '2026-10-28', 10, 15, 1, 5, 100)").run();
    const { values, networks } = adMetrics(db, LEDGER_STORE, P1.from, P1.to);
    expect(values.ad_spend.value).toBe(150);
    expect(values.platform_roas).toMatchObject({ value: null, note: 'Per network, never combined: Meta Ads 2.50×, TikTok Ads 1.50×' });
    expect(networks.map((n) => [n.network, n.roas])).toEqual([['meta', 2.5], ['tiktok', 1.5]]);
  });

  it("demo stores: Dashboard's spend, every value demo", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const { values, networks } = adMetrics(db, 'glow', '2026-10-19', '2026-10-25');
    const d = db.prepare("SELECT sum(ad_spend) AS s FROM daily_metrics WHERE store_id = 'glow' AND date BETWEEN '2026-10-19' AND '2026-10-25'").get()!;
    expect(values.ad_spend).toEqual({ value: Math.round(Number(d.s) * 100) / 100, status: 'demo' });
    expect(values.contribution_after_ads.status).toBe('demo');
    expect(networks.map((n) => n.network)).toEqual(['google', 'meta', 'tiktok']);
  });
});
