// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, saDef, type SaFunnelStep, type SaMetricId, type SaValue } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERIOD = { preset: 'custom', from: '2026-10-26', to: '2026-11-01', days: 7, partial: false };
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const SCOPE = { applied: [], ignored: [] };
const ok = (value: number, extra = {}): SaValue => ({ value, status: 'ok', ...extra });
const metric = (id: SaMetricId, v: SaValue) => ({ id, def: saDef(id), ...v, previous: null, change: changeOf(v.value, null, 'count') });
const GA4_NOTE = 'GA4 sends event counts, not purchasing sessions.';
const NOT_READ = { value: null, status: 'unavailable', reason: 'not_tracked', note: "TikTok Shop's visitors are read only for a TikTok Shop store without GA4" } as const;
const SHOPIFY = {
  source: 'shopify',
  metrics: [metric('sessions', ok(700)), metric('site_conversion', ok(0.02, { status: 'partial', note: '6 of 7 days reported' }))],
  steps: [
    { id: 'sessions', label: 'Sessions', unit: 'sessions', value: ok(700) },
    { id: 'add_to_carts', label: 'Sessions with an add to cart', unit: 'sessions', value: ok(84) },
    { id: 'checkouts', label: 'Sessions that reached checkout', unit: 'sessions', value: ok(35) },
    { id: 'purchase_sessions', label: 'Sessions that completed checkout', unit: 'sessions', value: ok(12, { status: 'partial', note: '6 of 7 days reported' }) },
  ] satisfies SaFunnelStep[],
  breakdowns: {
    source: { rows: [{ value: 'search', sessions: 400, purchase_sessions: 8 }, { value: 'direct', sessions: 280, purchase_sessions: null }, { value: 'unknown', sessions: 20, purchase_sessions: 0 }] },
    device: { rows: [], reason: 'failed' },
    country: { rows: [{ value: 'US', sessions: 600, purchase_sessions: null }, { value: 'unknown', sessions: 100, purchase_sessions: null }] },
  },
  channels: [{ channel: 'tiktok_shop', label: 'Visitors', value: NOT_READ }],
};
const GA4 = {
  ...SHOPIFY,
  source: 'ga4',
  metrics: [metric('sessions', ok(700)), metric('site_conversion', { value: null, status: 'unavailable', reason: 'unsupported', note: GA4_NOTE })],
  steps: [
    SHOPIFY.steps[0],
    { id: 'add_to_carts', label: 'Add-to-cart events', unit: 'events', value: ok(84) },
    { id: 'checkouts', label: 'Checkout events', unit: 'events', value: ok(35) },
    { id: 'purchase_sessions', label: 'Sessions that completed checkout', unit: 'sessions', value: { value: null, status: 'unavailable', reason: 'unsupported', note: GA4_NOTE } },
  ],
  channels: [],
};
const NO_SITE = { value: null, status: 'unavailable', reason: 'unsupported', note: 'TikTok Shop has no site: its visitors are its own traffic' } as const;
const TIKTOK = {
  ...SHOPIFY,
  source: null,
  metrics: [metric('sessions', NO_SITE), metric('site_conversion', NO_SITE)],
  steps: SHOPIFY.steps.map((x) => ({ ...x, value: NO_SITE })),
  channels: [{ channel: 'tiktok_shop', label: 'Visitors', value: ok(300, { status: 'partial', note: '3 of 7 days reported' }) }],
};
const series = (id: string) => ({ metric: id, def: saDef(id as SaMetricId), grain: 'day', period: PERIOD, compare: null, total: metric(id as SaMetricId, ok(1)), scope: SCOPE, points: [{ from: '2026-10-26', to: '2026-10-26', value: 100, status: 'ok', previous: null }] });

function render(path: string, traffic: object = SHOPIFY) {
  const fetch = stubApi((url) => {
    const q = new URL(url, 'http://x').searchParams;
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/series')) return series(q.get('metric')!);
    if (url.startsWith('/api/analytics/traffic')) return { period: PERIOD, compare: null, today: '2026-11-09', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: SCOPE, ...traffic };
    if (url.startsWith('/api/analytics/contributions')) return { change: 0, rows: [], scope: SCOPE };
    if (url.startsWith('/api/analytics/insights')) return { insights: [], rules: [] };
    if (url.startsWith('/api/analytics/listings')) return { rows: [], scope: SCOPE };
    if (url.startsWith('/api/analytics/overview'))
      return { period: PERIOD, compare: null, today: '2026-11-09', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: SCOPE, channels: [], annotations: 0, attention: 0, metrics: (['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'] as const).map((id) => metric(id, ok(1))) };
    return [];
  });
  renderApp(<Analytics />, path);
  return { fetch };
}
const where = () => decodeURIComponent(screen.getByTestId('where').textContent!);
const rows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1).map((r) => r.textContent);

describe('Traffic & Conversion tab (SA-102)', () => {
  it("Shopify: the KPIs, the funnel's rates against sessions with coverage, sessions by source and country, and a marketplace whose traffic isn't read", async () => {
    render('/analytics?store=a&tab=traffic');
    const kpis = await screen.findByRole('region', { name: 'Sessions and conversion' });
    expect(within(kpis).getByText('700')).toBeTruthy();
    expect(within(kpis).getByText('2.00%')).toBeTruthy();
    expect(rows(screen.getByRole('table', { name: 'Site funnel' }))).toEqual([
      'Sessions700',
      'Sessions with an add to cart8412%',
      'Sessions that reached checkout355%',
      'Sessions that completed checkout6 of 7 days reported122%',
    ]);
    expect(screen.getByText('Counted in sessions, as Shopify reports them')).toBeTruthy();
    expect(rows(screen.getByRole('table', { name: 'Sessions by source' }))).toEqual(['Search40057%2.00%', 'Direct28040%–', 'Unknown203%0.00%']);
    expect(screen.getByText(/^Unknown: sessions the source couldn't place/)).toBeTruthy();

    const by = screen.getByRole('radiogroup', { name: 'Sessions by' });
    fireEvent.click(within(by).getByRole('radio', { name: 'Country' }));
    expect(where()).toContain('traffic_by=country');
    expect(rows(await screen.findByRole('table', { name: 'Sessions by country' }))).toEqual(['United States60086%', 'Unknown10014%']); // no purchasing sessions: no conversion column
    fireEvent.click(within(by).getByRole('radio', { name: 'Device' }));
    expect(screen.getByText('Sync failed:')).toBeTruthy(); // no rows say why, never an empty table
    fireEvent.click(within(by).getByRole('radio', { name: 'Source' }));
    await waitFor(() => expect(where()).not.toContain('traffic_by'));

    const market = screen.getByRole('region', { name: 'Marketplace traffic' });
    expect(market.textContent).toContain("TikTok Shop visitorsNot trackedTikTok Shop's visitors are read only for a TikTok Shop store without GA4");
  });

  it('a GA4 store: conversion unavailable with the reason; carts and checkouts as events, with no rate against sessions', async () => {
    render('/analytics?store=a&tab=traffic', GA4);
    const kpis = await screen.findByRole('region', { name: 'Sessions and conversion' });
    expect(within(kpis).getByText('Not supported')).toBeTruthy();
    expect(within(kpis).getByText(GA4_NOTE)).toBeTruthy();
    expect(rows(screen.getByRole('table', { name: 'Site funnel' }))).toEqual([
      'Sessions700',
      'Add-to-cart events84',
      'Checkout events35',
      `Sessions that completed checkoutNot supported${GA4_NOTE}`,
    ]);
    expect(screen.getByText('Counted in sessions and events, as Google Analytics 4 reports them')).toBeTruthy();
    expect(screen.getByText(/^Carts and checkouts are event counts here/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Marketplace traffic' })).toBeNull();
  });

  it("a TikTok Shop store: no site funnel, said once; its visitors are its own traffic", async () => {
    render('/analytics?store=a&tab=traffic', TIKTOK);
    await screen.findByRole('region', { name: 'Sessions and conversion' });
    expect(screen.queryByRole('table', { name: 'Site funnel' })).toBeNull();
    expect(screen.getAllByText(NO_SITE.note)).toHaveLength(3); // the two KPI tiles and the funnel
    expect(screen.getByRole('region', { name: 'Marketplace traffic' }).textContent).toContain('TikTok Shop visitors3003 of 7 days reported');
  });

  it("the Overview's site conversion tile links to the tab", async () => {
    render('/analytics?store=a');
    await screen.findByText('Site conversion');
    const links = screen.getAllByRole('link', { name: 'Breakdown →' }).map((a) => a.getAttribute('href'));
    expect(links.some((h) => h?.includes('tab=traffic'))).toBe(true);
  });
});
