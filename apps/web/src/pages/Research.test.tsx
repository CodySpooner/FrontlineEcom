// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PrCard, PrDemandTab, PrDiscovery, PrHistoryRow, PrOffer, PrProductDetail, PrSourceHealth, PrSourceState, PrStoreProfile, Store } from '@frontline/shared';
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
  fit: { fit: 'weak', reason: 'battery' }, flags: { count: 0, first: null }, storesEvaluating: 0, research: null, firstSeenAt: '2026-10-27T00:00:00Z', evidenceAt: null, ...o,
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
    const filters = { category: 'Grooming', stage: 'shortlisted' as const, research: 'failed' as const, costMax: 1500, strict: ['cost', 'delivery'] };
    expect(Object.fromEntries(new URLSearchParams(discoveryQuery({ store: 'paws', shipTo: 'GB', view: 'all', sort: 'best_fit', q: ' brush ', filters })))).toEqual({
      store: 'paws', q: 'brush', view: 'all', sort: 'best_fit', category: 'Grooming', stage: 'shortlisted', research: 'failed', costMax: '1500', strict: 'cost', limit: '48',
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

  it("store scope: the footer shows the latest research task's execution state apart from the stage", async () => {
    api({ items: [card({ stage: 'researching', research: { taskId: 't1', status: 'interrupted', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() } })] });
    renderApp(<Research />, '/research');
    const c = await screen.findByRole('article', { name: 'Silicone grooming brush' });
    expect(within(c).getByText('Researching')).toBeTruthy(); // the stage, at the top
    expect(within(c).getByText('Interrupted (app restarted)')).toBeTruthy(); // the execution state, in the footer
    expect(within(c).getByText('Updated 5 min ago')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Research' })).toBeTruthy();
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

describe('Detail panel', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })); // jsdom has none; the Demand chart tracks its width
  const detail = (o: Partial<PrProductDetail> = {}): PrProductDetail => ({
    card: card({ fixture: false }), currency: 'USD', shipTo: 'US', sku: 'CJ-BRUSH-M', url: 'https://cjdropshipping.com/p/1',
    assessment: { fit: { fit: 'weak', reasons: ['battery', 'Missing price band'] }, demand: { level: 'moderate', sets: 1, ownOrders: false }, flags: [], confidence: { level: 'low', count: 1, has: { demand: true, offer: false, economics: false, report: false } } },
    notes: null, agentEstimates: null, stores: [], ...o,
  });
  const set: PrDemandTab['sets'][number] = {
    id: 's1', platform: 'google_trends', query: 'dog brush', region: 'US', granularity: 'week', metric: 'interest_over_time', scope: 'product', origin: 'import', periodStart: '2024-11-03', periodEnd: '2026-10-25',
    retrievedAt: '2026-10-26T00:00:00Z', points: 3, demandClass: 'sustained', peakMonth: null, momentum: 1, links: [],
    series: [{ at: '2026-10-11', value: 48 }, { at: '2026-10-18', value: 52 }, { at: '2026-10-25', value: 50 }],
  };
  const offer: PrOffer = {
    id: 'o1', supplier: 'CJdropshipping', variant: 'M / Grey', sku: 'CJ-BRUSH-M', destination: 'US', quantity: 1, method: 'CJPacket', unitCost: 342, shipCost: null, currency: 'USD', deliveryMin: 6, deliveryMax: 12,
    processingDays: null, moq: null, shipsFrom: 'CN', stock: [{ warehouse: 'CN', units: 120 }], provenance: 'live', checkedAt: '2026-10-27T00:00:00Z', status: 'pending', reasons: ['Shipping cost unknown'],
  };
  const history: PrHistoryRow[] = [{ id: 'h1', storeId: 'paws', kind: 'stage', from: null, to: 'discovered', reason: 'Assigned from All stores', by: 'owner', at: '2026-10-27T00:00:00Z' }];
  const panelApi = (d = detail()) =>
    stubApi((url) => {
      if (url.startsWith('/api/stores')) return [store, { ...store, id: 'glow', name: 'Glow Haus' }];
      if (url.startsWith('/api/pr/products?')) return page([card()]);
      if (url.includes('/demand?')) return { sets: [set], suggested: [{ ...set, id: 's2', scope: 'query' }], notes: [] } satisfies PrDemandTab;
      if (url.includes('/offers?')) return [offer];
      if (url.includes('/history?')) return history;
      if (url.includes('/assign')) return { ok: true };
      if (url.startsWith('/api/pr/signals/')) return {};
      if (url.startsWith('/api/pr/products/')) return d;
      if (url.startsWith('/api/pr/sources')) return [source({ fixtures: 10 })];
      if (url.startsWith('/api/pr/profile')) return profile;
      return [];
    });
  const bodyOf = (f: ReturnType<typeof panelApi>, part: string) => JSON.parse(String(f.mock.calls.find(([u]) => String(u).includes(part))![1]!.body));

  it('opens from a card: header with SKU and a safe listing link, each assessment part on its own, and the confidence rule', async () => {
    panelApi();
    renderApp(<Research />, '/research?store=paws');
    fireEvent.click(await screen.findByRole('article', { name: /Silicone grooming brush/ }));
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const link = await within(panel).findByRole('link', { name: 'Open listing' });
    expect([link.getAttribute('href'), link.getAttribute('rel'), link.getAttribute('target')]).toEqual(['https://cjdropshipping.com/p/1', 'noopener noreferrer', '_blank']);
    expect(within(panel).getByText(/SKU CJ-BRUSH-M/)).toBeTruthy();
    expect(within(panel).getByText('battery; Missing price band')).toBeTruthy();
    expect(within(panel).getByText('Moderate')).toBeTruthy();
    expect(within(panel).getAllByText('Not assessed yet')).toHaveLength(2); // economics and differentiation, until PR-18 and PR-17
    expect(within(panel).getByText('Evidence confidence: Low')).toBeTruthy();
    expect(within(panel).queryByRole('tab', { name: 'Economics' })).toBeNull(); // decision 1: absent until PR-18
    expect(within(panel).queryByRole('combobox', { name: 'Assign to a store' })).toBeNull(); // store scope
    expect(screen.getByTestId('where').textContent).toContain('product=p1');
  });

  it('Demand draws stored points with the Trends caption and confirms a suggested set; Suppliers says what is unknown', async () => {
    const f = panelApi();
    renderApp(<Research />, '/research?store=paws&product=p1&tab=demand');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    expect(await within(panel).findByText('Relative interest (0–100), not search volume or sales.')).toBeTruthy();
    expect(within(panel).getByRole('img', { name: /Google Trends "dog brush", 3 points/ })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: "Confirm it's about this product" }));
    await waitFor(() => expect(calls(f, '/api/pr/signals/s2/links')).toHaveLength(1));
    expect(bodyOf(f, '/api/pr/signals/s2/links')).toMatchObject({ productId: 'p1', confirmed: true });
    fireEvent.click(within(panel).getByRole('tab', { name: 'Suppliers' }));
    const o = await within(panel).findByRole('region', { name: 'CJdropshipping to US' });
    expect(within(o).getByText('Shipping cost unknown')).toBeTruthy();
    expect(within(o).getAllByText('Unknown').length).toBeGreaterThan(1); // shipping, processing, MOQ: never 0
    expect(within(panel).getByText('Duties: Unknown, left out of the figures above.')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toContain('tab=suppliers');
  });

  it('All stores: Assign to a store records it and switches to that store with the product still open; Esc closes it', async () => {
    const f = panelApi(detail({ assessment: { ...detail().assessment, fit: null }, stores: [{ id: 'glow', name: 'Glow Haus', stage: 'researching' }] }));
    renderApp(<Research />, '/research?store=all&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    expect(await within(panel).findByText('Glow Haus · Researching')).toBeTruthy();
    const pick = within(panel).getByRole('combobox', { name: 'Assign to a store' });
    expect(within(pick).queryByRole('option', { name: 'Glow Haus' })).toBeNull(); // already evaluating it
    fireEvent.change(pick, { target: { value: 'paws' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('store=paws'));
    expect(bodyOf(f, '/assign')).toEqual({ storeId: 'paws' });
    expect(screen.getByTestId('where').textContent).toContain('product=p1');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Product details' })).toBeNull());
  });

  it('owner edits: a stage move asks why, a flag is dismissed with a reason, notes save, and a Creative Center note is added', async () => {
    const flag = { id: 'restricted:batteries', label: 'Batteries', kind: 'restricted' as const, reason: 'Title mentions "rechargeable"' };
    const f = panelApi(detail({ assessment: { ...detail().assessment, flags: [flag] } }));
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    fireEvent.change(await within(panel).findByRole('combobox', { name: 'Stage' }), { target: { value: 'shortlisted' } });
    const why = within(panel).getByRole('textbox', { name: /Why move it to Shortlisted/ });
    expect((within(panel).getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true); // no reason yet
    fireEvent.change(why, { target: { value: 'Ships in 8 days' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/stage?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/stage?')).toEqual({ stage: 'shortlisted', reason: 'Ships in 8 days' });

    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss…' }));
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Why Batteries does not apply' }), { target: { value: 'Sealed USB-C cell' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/flags/restricted%3Abatteries/dismiss?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/dismiss?')).toMatchObject({ reason: 'Sealed USB-C cell' });

    fireEvent.change(within(panel).getByRole('textbox', { name: 'Your notes' }), { target: { value: 'Ask for a UK warehouse ' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/store-notes?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/store-notes?')).toEqual({ notes: 'Ask for a UK warehouse' });

    fireEvent.click(within(panel).getByRole('tab', { name: 'Demand' }));
    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Link you looked at' }), { target: { value: 'https://ads.tiktok.com/business/creativecenter/x' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'What you saw' }), { target: { value: '3 creators posted it this week' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/notes?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/notes?')).toMatchObject({ platform: 'tiktok_creative_center', url: 'https://ads.tiktok.com/business/creativecenter/x', note: '3 creators posted it this week' });
  });

  it("Watch: the card's eye watches without opening the card; All stores' panel watches for all stores", async () => {
    const f = panelApi();
    renderApp(<Research />, '/research?store=paws');
    fireEvent.click(await screen.findByRole('button', { name: 'Watch Silicone grooming brush' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/watch?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/watch?store=paws')).toEqual({ on: true });
    expect(screen.getByTestId('where').textContent).not.toContain('product=');
    cleanup();
    const g = panelApi();
    renderApp(<Research />, '/research?store=all&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Watch for all stores' }));
    await waitFor(() => expect(calls(g, '/api/pr/products/p1/watch?')).toHaveLength(1));
    expect(within(panel).queryByRole('combobox', { name: 'Stage' })).toBeNull();
    expect(within(panel).queryByRole('textbox', { name: 'Your notes' })).toBeNull();
  });
});
