// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PrCard, PrDiscovery, PrSourceHealth, PrSourceState, PrStoreProfile, Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { discoveryQuery } from '../product-research/Filters';
import { sourceItem } from '../product-research/format';
import { Research } from './Research';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store: Store = { id: 'paws', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true };
const card = (o: Partial<PrCard> = {}): PrCard => ({
  id: 'p1', title: 'Silicone grooming brush', imageListing: null, category: 'Pet Supplies > Grooming', source: { id: 'l1', label: 'CJdropshipping', host: null, origin: 'fixture' }, fixture: true, privateTo: null,
  stage: 'discovered', watched: false, costShip: null, fulfillment: { status: 'pending', reasons: ['Fixture offer: not verified'], checkedAt: '2026-10-27T00:00:00Z' }, conditions: null,
  demand: { cls: 'sustained', peakMonth: null, platform: 'google_trends', query: 'grooming brush', region: 'US', periodStart: '2024-11-03', periodEnd: '2026-10-25', scope: 'product' }, demandSets: 0,
  fit: { fit: 'weak', reason: 'battery' }, flags: { count: 0, first: null }, storesEvaluating: 0, firstSeenAt: '2026-10-27T00:00:00Z', evidenceAt: null, ...o,
});
const page = (items: PrCard[], o: Partial<PrDiscovery> = {}): PrDiscovery => ({
  items, next: null, total: items.length, counts: { all: items.length, demand: 0, new: items.length, watchlist: 0, flagged: 0 },
  facets: { categories: [{ value: 'Pet Supplies > Grooming', label: 'Pet Supplies > Grooming', n: 1 }], sources: [{ value: 'cj', label: 'CJdropshipping', n: 1 }], warehouses: [], suppliers: [] },
  currency: 'USD', shipTo: 'US', shipTos: ['US', 'CA'], fxDate: null, ...o,
});
const source = (o: Partial<PrSourceState>): PrSourceState => ({ id: 'cj', name: 'CJdropshipping', answers: ['discovery', 'fulfillment'], access: 'credentials_required', connect: 'Paste the API key in Integrations.', status: null, lastSuccessAt: null, lastError: null, errorKind: null, products: 0, fixtures: 0, ...o });
const profile: PrStoreProfile = {
  storeId: 'paws', audience: null, priceMin: 1500, priceMax: 4000, priceCurrency: 'USD', shipTo: 'US', shipToDefault: true, warehouses: ['US'], maxDeliveryDays: 12,
  avoidCategories: ['batteries'], avoidTerms: [], includeCategories: [], keywords: [], updatedAt: null,
};

function api(o: { items?: PrCard[]; sources?: PrSourceState[]; d?: Partial<PrDiscovery> } = {}) {
  return stubApi((url, init) => {
    if (url.startsWith('/api/stores')) return [store];
    if (url.startsWith('/api/pr/products')) return page(o.items ?? [card()], o.d);
    if (url.startsWith('/api/pr/sources')) return o.sources ?? [source({ fixtures: 10 })];
    if (url.startsWith('/api/pr/profile')) return init?.method === 'PUT' ? { ...profile, ...JSON.parse(String(init.body)) } : profile;
    return [];
  });
}
const calls = (f: ReturnType<typeof api>, path: string) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith(path));

describe('the discovery query', () => {
  it('sends ship-to only in All stores, drops store-only filters there, and names strict filters only when they are set', () => {
    const filters = { category: 'Grooming', stage: 'shortlisted' as const, costMax: 1500, strict: ['cost', 'delivery'] };
    expect(Object.fromEntries(new URLSearchParams(discoveryQuery({ store: 'paws', shipTo: 'GB', view: 'all', sort: 'best_fit', q: ' brush ', filters })))).toEqual({
      store: 'paws', q: 'brush', view: 'all', sort: 'best_fit', category: 'Grooming', stage: 'shortlisted', costMax: '1500', strict: 'cost', limit: '48',
    });
    expect(Object.fromEntries(new URLSearchParams(discoveryQuery({ store: null, shipTo: 'GB', view: 'new', sort: 'recent', q: '', filters })))).toEqual({
      shipTo: 'GB', view: 'new', sort: 'recent', category: 'Grooming', costMax: '1500', strict: 'cost', limit: '48',
    });
  });

  it("says each source's real state; fixture rows never read as connected", () => {
    expect([
      source({ fixtures: 3 }),
      source({ access: 'verified', lastSuccessAt: new Date(Date.now() - 18 * 60_000).toISOString() }),
      source({ name: 'Google Trends', access: 'authorized_import', products: 14 }),
      source({ name: 'TikTok Creative Center', access: 'manual_only' }),
      source({ access: 'verified', status: 'error', errorKind: 'auth', lastError: 'key refused' }),
    ].map((s) => sourceItem(s).text)).toEqual([
      'CJdropshipping · test fixtures (not connected)',
      'CJdropshipping · synced 18 min ago',
      'Google Trends · imports, 14 products',
      'TikTok Creative Center · manual notes only',
      'CJdropshipping · error: key refused',
    ]);
  });
});

describe('Product Research page', () => {
  it('store scope: the profile line, tabs with server counts, the source strip and a card with its unknowns spelled out', async () => {
    api();
    renderApp(<Research />, '/research');
    const c = await screen.findByRole('article', { name: 'Silicone grooming brush' });
    expect(screen.getByText(/Ranked for/).textContent).toBe('Ranked for Pawsome Gear · Pet · audience not set · sells at $15.00–$40.00 · prefers US warehouse or ≤ 12 days · avoids batteries · Edit research profile');
    expect(screen.getByRole('tab', { name: /^Newly discovered ?1$/ })).toBeTruthy();
    expect(screen.getByText('CJdropshipping · test fixtures (not connected)')).toBeTruthy();
    expect(within(c).getByText('Test fixture')).toBeTruthy();
    expect(within(c).getByText('Discovered')).toBeTruthy();
    expect(within(c).getByText('Unknown').getAttribute('title')).toBe('Fixture offer: not verified'); // never 0 when a part is missing
    expect(within(c).getByText('Supplier found—verification pending')).toBeTruthy();
    expect(within(c).getByText('Weak, battery')).toBeTruthy();
    expect(within(c).getByText('No flags found (rule checks only)')).toBeTruthy();
    expect(within(c).getByText('Trends "grooming brush" · US · Nov 2024–Oct 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Research a Product/ })).toBeNull(); // absent until PR-16 (decision 1)
    expect(screen.getByText('1 match · filtered and sorted on the server')).toBeTruthy();
  });

  it('All stores: no profile line, no stage or fit, the evaluating count, and ship-to sent from the toolbar', async () => {
    const f = api({ items: [card({ stage: null, fit: null, storesEvaluating: 2 })] });
    renderApp(<Research />, '/research?store=all');
    const c = await screen.findByRole('article', { name: 'Silicone grooming brush' });
    expect(screen.queryByText(/Ranked for/)).toBeNull();
    expect(within(c).queryByText('Discovered')).toBeNull();
    expect(within(c).queryByText(/Fit for/)).toBeNull();
    expect(within(c).getByText('2 stores evaluating')).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Best fit/ })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Ship to' }), { target: { value: 'CA' } });
    await waitFor(() => expect(calls(f, '/api/pr/products').at(-1)).toContain('shipTo=CA'));
    expect(localStorage.getItem('fe.research.shipTo')).toBe('"CA"');
  });

  it('a chip filters on the server and keeps unknowns until the owner switches that off', async () => {
    const f = api();
    renderApp(<Research />, '/research');
    await screen.findByRole('article', { name: 'Silicone grooming brush' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Delivery at most' }), { target: { value: '15' } });
    await waitFor(() => expect(calls(f, '/api/pr/products').at(-1)).toContain('deliveryMax=15'));
    expect(calls(f, '/api/pr/products').at(-1)).not.toContain('strict=');
    fireEvent.click(screen.getByRole('button', { name: 'unknown included' }));
    await waitFor(() => expect(calls(f, '/api/pr/products').at(-1)).toContain('strict=delivery'));
    expect(screen.getByRole('button', { name: 'unknown excluded' })).toBeTruthy();
  });

  it('first use: no source connected and nothing found says what to connect, from the server', async () => {
    api({
      items: [],
      sources: [
        source({}),
        source({ id: 'tiktok', name: 'TikTok Creative Center', answers: ['discovery'], access: 'manual_only', connect: 'Add a note.' }),
        source({ id: 'trends', name: 'Google Trends', answers: ['demand'], access: 'authorized_import', connect: 'Upload a CSV.' }),
        source({ id: 'feed', name: 'Supplier feed', answers: ['fulfillment'], access: 'authorized_import', connect: 'Upload a feed.' }),
      ],
    });
    renderApp(<Research />, '/research');
    expect(await screen.findByText('No product sources connected yet')).toBeTruthy();
    expect(screen.getByText('Paste the API key in Integrations.')).toBeTruthy();
    expect(screen.getByText('Upload a feed.')).toBeTruthy();
    expect(screen.queryByText('Add a note.')).toBeNull(); // a note needs a product
    expect(screen.queryByText('Upload a CSV.')).toBeNull(); // demand only
  });

  it('no match: names the filters that are set and clears them', async () => {
    localStorage.setItem('fe.research.filters', JSON.stringify({ category: 'Toys' }));
    const f = api({ items: [] });
    renderApp(<Research />, '/research');
    expect(await screen.findByText('No products match these filters')).toBeTruthy();
    expect(screen.getByText('Set: category.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(calls(f, '/api/pr/products').at(-1)).not.toContain('category='));
  });

  it('a source that refused its credentials says so and how to fix it', async () => {
    api({ sources: [source({ access: 'verified', status: 'error', errorKind: 'auth', lastError: 'API key refused' })] });
    renderApp(<Research />, '/research');
    expect(await screen.findByText('CJdropshipping is disconnected: API key refused. Reconnect it in Integrations.')).toBeTruthy();
  });

  it('Edit research profile saves the fields as the API takes them', async () => {
    const f = api();
    renderApp(<Research />, '/research');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit research profile' }));
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'US dog owners' } });
    fireEvent.change(screen.getByLabelText('To (USD)'), { target: { value: '39.99' } });
    fireEvent.change(screen.getByLabelText('Avoided terms'), { target: { value: 'airtag, Airtag , lithium' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(f.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true));
    const [url, init] = f.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(url).toBe('/api/pr/profile?store=paws');
    expect(JSON.parse(String(init!.body))).toEqual({
      audience: 'US dog owners', priceMin: 1500, priceMax: 3999, shipTo: null, maxDeliveryDays: 12,
      warehouses: ['US'], includeCategories: [], avoidCategories: ['batteries'], avoidTerms: ['airtag', 'Airtag', 'lithium'], keywords: [],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit research profile' }));
    fireEvent.change(screen.getByLabelText('To (USD)'), { target: { value: 'forty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter the price band as amounts in USD, like 15 or 39.99.');
  });

  it('keyboard: / focuses search, Enter opens a card into the URL, Esc closes it and focus returns to the card', async () => {
    api({ items: [card(), card({ id: 'p2', title: 'Slow feeder mat' })] });
    renderApp(<Research />, '/research');
    const c = await screen.findByRole('article', { name: 'Silicone grooming brush' });
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search products' }));
    c.focus();
    fireEvent.keyDown(c, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Slow feeder mat' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('product=p2'));
    expect(screen.getByRole('article', { name: 'Slow feeder mat' }).getAttribute('aria-current')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('product='));
    expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Slow feeder mat' }));
  });
});

describe('Source health', () => {
  const health = (o: Partial<PrSourceHealth> = {}): PrSourceHealth => ({
    ...source({ access: 'verified', status: 'ok', lastSuccessAt: '2026-10-28T09:00:00Z', products: 4 }),
    rate: '1 request a second', quota: '50,000 points a day', refreshHours: 24, lastAttemptAt: '2026-10-28T09:00:00Z', stopped: null,
    points: { remaining: 49_900, total: 50_000 }, callsToday: [{ purpose: 'ingestion', calls: 2, cap: 500 }], ledger: [{ purpose: 'ingestion', at: '2026-10-28T09:00:00Z', ok: true }],
    jobs: [], stale: 3, canSync: true, syncing: false, ...o,
  });

  it('opens from the strip with each source\'s limits and coverage, and Sync now only where it works', async () => {
    let syncing = false;
    const f = stubApi((url) => {
      if (url.startsWith('/api/stores')) return [store];
      if (url.startsWith('/api/pr/products')) return page([card()]);
      if (url.startsWith('/api/pr/sources/cj/sync')) return (syncing = true), { jobs: 1 };
      if (url.startsWith('/api/pr/sources')) return [source({ fixtures: 10 })];
      if (url.startsWith('/api/pr/source-health')) return [health({ syncing }), health({ ...source({ id: 'tiktok', name: 'TikTok Creative Center', access: 'manual_only', connect: 'Add a note.' }), canSync: false, refreshHours: null, points: null, callsToday: [], ledger: [], stale: 0 })];
      if (url.startsWith('/api/pr/profile')) return profile;
      return [];
    });
    renderApp(<Research />, '/research');
    fireEvent.click(await screen.findByRole('button', { name: 'Source health' }));
    const cj = await screen.findByRole('region', { name: 'CJdropshipping' });
    expect(within(cj).getByText('49,900 of 50,000 points left today')).toBeTruthy();
    expect(within(cj).getByText('ingestion 2 of 500')).toBeTruthy();
    expect(within(cj).getByText('3 products: newest offer check over 7 days old')).toBeTruthy();
    const tiktok = screen.getByRole('region', { name: 'TikTok Creative Center' });
    expect(within(tiktok).queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(within(tiktok).getByText('Add a note.')).toBeTruthy();
    fireEvent.click(within(cj).getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => u === '/api/pr/sources/cj/sync' && i?.method === 'POST')).toBe(true));
    expect(await within(cj).findByRole('button', { name: 'Syncing…' })).toBeTruthy();
  });
});
