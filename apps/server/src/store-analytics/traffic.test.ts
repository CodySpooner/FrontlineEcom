// SA-21: sessions and site conversion beyond the oracle.
import type { SaTraffic } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { insertStore } from '../stores';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { trafficBreakdown, trafficFunnel, trafficMetrics } from './traffic';

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

const GA4 = "INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES ('ga4:ledger', 'ga4', 'ledger', 'connected', '{}', '', '2026-11-09')";
const steps = (f: ReturnType<typeof trafficFunnel>) => f.steps.map((s) => [s.id, s.label, s.unit, s.value.value]);

describe('trafficFunnel (SA-100)', () => {
  it('Shopify: every step in sessions over the reported days; conversion is the KPI; a marketplace channel not read says so', () => {
    const db = openDb();
    seedLedgerStore(db);
    const f = trafficFunnel(db, LEDGER_STORE, P1.from, P1.to);
    expect(f.source).toBe('shopify');
    expect(steps(f)).toEqual([
      ['sessions', 'Sessions', 'sessions', 700],
      ['add_to_carts', 'Sessions with an add to cart', 'sessions', 84],
      ['checkouts', 'Sessions that reached checkout', 'sessions', 35],
      ['purchase_sessions', 'Sessions that completed checkout', 'sessions', 12], // Oct 27 unreported: 6 days
    ]);
    expect(f.steps[3]!.value).toMatchObject({ status: 'partial', coverage: { share: 6 / 7, of: 'days' } });
    expect(f.conversion).toEqual(trafficMetrics(db, LEDGER_STORE, P1.from, P1.to).site_conversion);
    expect(f.conversion.value).toBeCloseTo(12 / 600);
    expect(f.channels).toEqual([{ channel: 'tiktok_shop', label: 'Visitors', value: { value: null, status: 'unavailable', reason: 'not_tracked', note: "TikTok Shop's visitors are read only for a TikTok Shop store without GA4" } }]);
  });

  it("GA4: carts and checkouts are event counts, labelled so; purchasing sessions aren't reported", () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare(GA4).run();
    const f = trafficFunnel(db, LEDGER_STORE, P1.from, P1.to);
    expect(f.source).toBe('ga4');
    expect(steps(f)).toEqual([
      ['sessions', 'Sessions', 'sessions', 700],
      ['add_to_carts', 'Add-to-cart events', 'events', 84],
      ['checkouts', 'Checkout events', 'events', 35],
      ['purchase_sessions', 'Sessions that completed checkout', 'sessions', null],
    ]);
    expect(f.steps[3]!.value).toMatchObject({ reason: 'unsupported', note: 'GA4 sends event counts, not purchasing sessions.' });
  });

  it("a TikTok Shop store: its visitors are its own traffic, never the site's sessions", () => {
    const db = openDb();
    insertStore(db, { id: 'tt1', name: 'TT Shop', platform: 'tiktok_shop', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at) VALUES ('tiktok_shop:tt1', 'tiktok_shop', 'tt1', 'connected', '{}', '', '2026-11-09')").run();
    const visits = db.prepare("INSERT INTO daily_metrics (store_id, date, sessions) VALUES ('tt1', ?, 100)");
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) visits.run(d);
    const f = trafficFunnel(db, 'tt1', P1.from, P1.to);
    expect(f.source).toBeNull();
    expect(f.channels).toEqual([{ channel: 'tiktok_shop', label: 'Visitors', value: { value: 300, status: 'partial', coverage: { share: 3 / 7, of: 'days' }, note: '3 of 7 days reported' } }]);
    for (const s of f.steps) expect(s.value).toEqual({ value: null, status: 'unavailable', reason: 'unsupported', note: 'TikTok Shop has no site: its visitors are its own traffic' });
    expect(trafficMetrics(db, 'tt1', P1.from, P1.to).sessions.value).toBeNull(); // decision 14
    // disconnected: its visitors read before still show as its own
    db.prepare("DELETE FROM integrations WHERE id = 'tiktok_shop:tt1'").run();
    expect(trafficFunnel(db, 'tt1', P1.from, P1.to).channels.map((c) => [c.channel, c.value.value])).toEqual([['tiktok_shop', 300]]);
  });

  it("demo: every step demo, conversion the KPI's", () => {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    const f = trafficFunnel(db, 'glow', '2026-10-19', '2026-10-25');
    expect(f.steps.map((s) => s.value.status)).toEqual(['demo', 'demo', 'demo', 'demo']);
    const [sessions, carts, checkouts, bought] = f.steps.map((s) => s.value.value!);
    expect(sessions).toBeGreaterThan(carts!);
    expect(carts).toBeGreaterThan(checkouts!);
    expect(bought).toBeGreaterThan(0);
    expect(f.conversion).toEqual(trafficMetrics(db, 'glow', '2026-10-19', '2026-10-25').site_conversion);
    // a cut period (today so far): the last day's counts scale with it
    const last = db.prepare("SELECT add_to_carts AS c FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()!;
    const cut = trafficFunnel(db, 'glow', '2026-10-19', '2026-10-25', { cut: { at: '2026-10-25T16:00:00Z', fraction: 0.5 } });
    expect(cut.steps[1]!.value.value).toBe(Math.round(carts! - Number(last.c) / 2));
  });
});

describe('trafficBreakdown (SA-100)', () => {
  const put = (db: ReturnType<typeof openDb>, rows: [string, string, string, number, number | null, string][]) => {
    const ins = db.prepare("INSERT INTO traffic_breakdown_daily (store_id, date, dimension, value, sessions, purchase_sessions, source) VALUES ('ledger', ?, ?, ?, ?, ?, ?)");
    for (const r of rows) ins.run(...r);
  };

  it("the traffic source's rows summed per value, unknown last; purchasing sessions only when every day has them", () => {
    const db = openDb();
    seedLedgerStore(db);
    put(db, [
      ['2026-10-26', 'source', 'direct', 40, 1, 'shopify'],
      ['2026-10-27', 'source', 'direct', 30, null, 'shopify'],
      ['2026-10-26', 'source', 'search', 50, 1, 'shopify'],
      ['2026-10-27', 'source', 'search', 60, 0, 'shopify'],
      ['2026-10-26', 'source', 'unknown', 200, 0, 'shopify'],
      ['2026-10-25', 'source', 'search', 99, 9, 'shopify'], // before P1
      ['2026-10-28', 'device', 'mobile', 70, 2, 'shopify'],
    ]);
    expect(trafficBreakdown(db, LEDGER_STORE, P1.from, P1.to, 'source')).toEqual({
      rows: [
        { value: 'search', sessions: 110, purchase_sessions: 1 },
        { value: 'direct', sessions: 70, purchase_sessions: null },
        { value: 'unknown', sessions: 200, purchase_sessions: 0 }, // last, whatever its size
      ],
    });
    // GA4 connected: only its rows count
    db.prepare(GA4).run();
    put(db, [['2026-10-29', 'source', 'Organic Search', 80, null, 'ga4']]);
    expect(trafficBreakdown(db, LEDGER_STORE, P1.from, P1.to, 'source').rows).toEqual([{ value: 'Organic Search', sessions: 80, purchase_sessions: null }]);
  });

  it('no rows say why, never an empty table that reads as no traffic', () => {
    const db = openDb();
    seedLedgerStore(db);
    expect(trafficBreakdown(db, LEDGER_STORE, P1.from, P1.to, 'country')).toEqual({ rows: [], reason: 'needs_ingestion' });
    insertStore(db, { id: 'woo1', name: 'Woo', platform: 'woocommerce', niche: 'home', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true });
    expect(trafficBreakdown(db, 'woo1', P1.from, P1.to, 'source')).toEqual({ rows: [], reason: 'unsupported', note: 'WooCommerce has no sessions API; connect GA4.' });
    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    expect(trafficBreakdown(demo, 'glow', '2026-10-19', '2026-10-25', 'device')).toMatchObject({ rows: [], reason: 'unsupported' });
  });
});

describe('GET /api/analytics/traffic (SA-101)', () => {
  afterEach(() => vi.useRealTimers());
  const report = async (db: ReturnType<typeof openDb>, q = '') => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const res = await createApp(db).request(`/api/analytics/traffic?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}${q}`);
    expect(res.status).toBe(200);
    return (await res.json()) as SaTraffic;
  };

  it('the KPIs with their comparison, the funnel where each step is reported, the three breakdowns and the channels', async () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare("INSERT INTO traffic_breakdown_daily (store_id, date, dimension, value, sessions, purchase_sessions, source) VALUES ('ledger', '2026-10-26', 'device', 'mobile', 70, 1, 'shopify'), ('ledger', '2026-10-26', 'device', 'desktop', 30, 1, 'shopify')").run();
    const t = await report(db, '&compare=previous');
    expect(t.metrics.map((m) => [m.id, m.value, m.previous?.value])).toEqual([
      ['sessions', 700, 700],
      ['site_conversion', 12 / 600, 14 / 700],
    ]);
    expect(t.source).toBe('shopify');
    expect(t.steps.map((s) => [s.id, s.value.value])).toEqual([['sessions', 700], ['add_to_carts', 84], ['checkouts', 35], ['purchase_sessions', 12]]);
    expect(t.breakdowns).toEqual({
      source: { rows: [], reason: 'needs_ingestion' },
      device: { rows: [{ value: 'mobile', sessions: 70, purchase_sessions: 1 }, { value: 'desktop', sessions: 30, purchase_sessions: 1 }] },
      country: { rows: [], reason: 'needs_ingestion' },
    });
    expect(t.channels.map((c) => [c.channel, c.value.reason])).toEqual([['tiktok_shop', 'not_tracked']]);
  });

  it('a GA4 store: conversion unavailable with the reason, carts and checkouts as events', async () => {
    const db = openDb();
    seedLedgerStore(db);
    db.prepare(GA4).run();
    const t = await report(db);
    expect(t.metrics[1]).toMatchObject({ id: 'site_conversion', value: null, status: 'unavailable', reason: 'unsupported', note: 'GA4 sends event counts, not purchasing sessions.' });
    expect(t.steps.map((s) => s.unit)).toEqual(['sessions', 'events', 'events', 'sessions']);
  });
});
