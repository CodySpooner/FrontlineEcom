// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaContext, SaFreshness } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, reply } from '../test-utils';
import { storeLine } from './ContextBar';

const NOW = Date.parse('2026-10-28T15:00:00Z'); // 11:00 in New York
const row = (source: SaFreshness['source'], dataset: SaFreshness['dataset'], minutesAgo: number | null, extra: Partial<SaFreshness> = {}): SaFreshness => ({
  source, dataset, status: 'available', lastSuccess: minutesAgo == null ? null : new Date(NOW - minutesAgo * 60_000).toISOString(), lastTry: null, stale: false, error: null, coveredFrom: null, coveredTo: null, ...extra,
});
const context = (storeId: string, name: string, freshness: SaFreshness[]): SaContext => ({
  storeId, name, niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, zone: 'America/New_York', zoneLabel: 'America/New_York', zoneAbbr: 'ET', historyStart: '2025-01-01', freshness,
  channels: [{ kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }, { kind: 'meta_ads', name: 'Meta Ads', status: 'connected' }],
});
const CONTEXTS: Record<string, SaContext> = {
  a: context('a', 'Glow Haus', [row('shopify', 'orders', 6), row('meta_ads', 'ad_spend', 200, { stale: true }), row('shopify', 'customers', 1), row('ga4', 'traffic', null, { status: 'needs_credentials' })]),
  b: context('b', 'Pawsome Gear', [row('shopify', 'orders', 2)]),
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/stores') return reply([{ id: 'a', name: 'Glow Haus' }, { id: 'b', name: 'Pawsome Gear' }]);
    if (url.startsWith('/api/analytics/context')) return reply(CONTEXTS[new URL(url, 'http://x').searchParams.get('store')!]);
    return new Promise<Response>(() => {}); // the Overview's own reads
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Context bar (SA-63)', () => {
  it("the freshness chip shows the tab's oldest dataset (a stale one), listing each source in its tooltip", async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    expect(await screen.findByText('Synced 3 h ago')).toBeTruthy(); // Meta's stale ad spend, not Shopify's 6-minute-old orders
    const tip = screen.getByRole('tooltip').textContent!;
    expect(tip).toContain('Shopify · Orders: synced 6 min ago');
    expect(tip).toContain('Meta Ads · Ad spend: synced 3 h ago (stale)');
    expect(tip).not.toContain('Customers'); // not an Overview dataset
    expect(tip).not.toContain('GA4'); // not connected: nothing to be fresh
  });

  it('names the store with its niche and sales channels, the zone and currency, and the period and comparison with their dates', async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    expect(await screen.findByText('Beauty · Shopify site + TikTok Shop')).toBeTruthy();
    expect(screen.getByText('ET · USD')).toBeTruthy();
    expect(screen.getByText('Sep 28 – Oct 27 · full days')).toBeTruthy(); // the board's dates
    expect(screen.getByText('Aug 29 – Sep 27')).toBeTruthy();
    cleanup();
    renderApp(<Analytics />, '/analytics?store=a&period=mtd&compare=year');
    expect(await screen.findByText('Oct 1 – Oct 28 · today so far')).toBeTruthy();
    expect(screen.getByText('Oct 1 – Oct 28')).toBeTruthy(); // a year earlier
    expect(storeLine({ niche: 'pet', platform: 'amazon', channels: [] })).toBe('Pet · Amazon');
  });

  it('switches store from the picker without touching the app-wide selection', async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    await screen.findByText('Synced 3 h ago');
    fireEvent.click(screen.getByRole('menuitem', { name: /Pawsome Gear/, hidden: true })); // inside the closed popover
    expect(await screen.findByText('Synced 2 min ago')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Store: Pawsome Gear. Switch store' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('store=b'));
    expect(localStorage.getItem('fe.stores')).toBe('[]');
  });
});
