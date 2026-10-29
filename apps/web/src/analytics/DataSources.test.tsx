// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaSourceRow } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, reply } from '../test-utils';

const row = (r: Partial<SaSourceRow> & Pick<SaSourceRow, 'source' | 'dataset' | 'status' | 'name' | 'label'>): SaSourceRow => ({
  lastSuccess: null, lastTry: null, stale: false, error: null, coveredFrom: null, coveredTo: null, field: 'the documented field', backoffUntil: null, ...r,
});
const ROWS: SaSourceRow[] = [
  row({ source: 'shopify', dataset: 'orders', status: 'available', name: 'Shopify', label: 'Orders', lastSuccess: new Date(Date.now() - 6 * 60_000).toISOString(), rereading: 0.427 }),
  row({ source: 'shopify', dataset: 'catalog', status: 'verified', name: 'Shopify', label: 'Catalog', lastSuccess: new Date().toISOString(), verified: { at: '2026-10-27T12:00:00Z', account: 'glow.myshopify.com', note: '7 days matched Shopify Analytics' } }),
  row({ source: 'meta_ads', dataset: 'ad_spend', status: 'failed', reason: 'failed', name: 'Meta Ads', label: 'Ad spend', error: 'Meta rejected the access token', backoffUntil: '2026-10-29T18:30:00Z', fix: { label: 'Check Meta Ads', href: '/settings?section=integrations&store=a' } }),
  row({ source: 'ga4', dataset: 'traffic', status: 'needs_credentials', reason: 'needs_credentials', name: 'Google Analytics 4', label: 'Sessions', fix: { label: 'Connect Google Analytics 4', href: '/settings?section=integrations&store=a' } }),
  row({ source: 'demo', dataset: 'inventory', status: 'demo', name: 'Demo data', label: 'Inventory' }),
];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/stores') return reply([{ id: 'a', name: 'Glow Haus' }]);
    if (url.startsWith('/api/analytics/context')) return reply({ storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] });
    if (url.startsWith('/api/analytics/sources')) return reply(ROWS);
    if (url.startsWith('/api/analytics/reconcile')) return reply({ dedupe: { channels: [], unmapped: 0, lines: ['3 TikTok Shop orders matched, 0 counted twice'] } });
    return new Promise<Response>(() => {});
  }));
});
afterEach(cleanup);

describe('Data sources panel (SA-64)', () => {
  it('each source × dataset in the shared words, with what to do; nothing says connected for a source with no integration', async () => {
    renderApp(<Analytics />, '/analytics?store=a&panel=sources');
    const panel = within(await screen.findByRole('dialog', { name: 'Data sources' }));
    await panel.findByText('Awaiting connection');
    expect(panel.getByText('Sync failed')).toBeTruthy();
    expect(panel.getByText('Demo data', { selector: 'span' })).toBeTruthy();
    expect(panel.getByText('Available (not verified live)')).toBeTruthy();
    expect(panel.getByText('Live verified')).toBeTruthy();
    expect(panel.getByText('Live verified Oct 27, 2026: 7 days matched Shopify Analytics')).toBeTruthy();
    expect(panel.getByText('Meta rejected the access token')).toBeTruthy();
    expect(panel.getByText(/^Failing repeatedly: next try /)).toBeTruthy();
    expect(panel.getByText('Re-reading history: 42% done')).toBeTruthy();
    expect(panel.getByRole('link', { name: 'Connect Google Analytics 4' }).getAttribute('href')).toBe('/settings?section=integrations&store=a');
    expect(panel.getByText('Syncs run only while Frontline Ecom is open.')).toBeTruthy();
    expect(await panel.findByText('3 TikTok Shop orders matched, 0 counted twice')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\bconnected\b/i);
  });

  it('opens from the ⓘ beside the freshness chip and closes back to the page', async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    fireEvent.click(await screen.findByRole('button', { name: 'Data sources' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('panel=sources'));
    expect(await screen.findByText('Awaiting connection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('panel='));
  });
});
