// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PrBrief, PrCard, PrComparison, PrDemandTab, PrDiscovery, PrEconomics, PrLinks, PrMatches, PrOutcomes, PrWatch, PrHistoryRow, PrOffer, PrProductDetail, PrReport, PrSourceHealth, PrSourceState, PrSpecialistTeam, PrStoreProfile, PrTask, SquadMission, Store } from '@frontline/shared';
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
    expect(screen.getByRole('button', { name: 'Research a Product' })).toBeTruthy(); // PR-16
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
    expect(screen.getByText('Research a Product works now:')).toBeTruthy(); // PR-16
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

  it('scale: 10,000 matches load 48 at a time; past 300 cards only the rows near the viewport stay in the DOM, and they follow the scroll', async () => {
    const batch = (n: number) => Array.from({ length: 48 }, (_, k) => card({ id: `p${n * 48 + k}`, title: `Product ${n * 48 + k}` }));
    const f = stubApi((url) => {
      if (url.startsWith('/api/stores')) return [store];
      if (url.startsWith('/api/pr/products?')) {
        const n = Number(new URLSearchParams(url.split('?')[1]).get('cursor') || 0);
        return page(batch(n), { next: String(n + 1), total: 10_000, counts: { all: 10_000, demand: 0, new: 10_000, watchlist: 0, flagged: 0 } });
      }
      if (url.startsWith('/api/pr/sources')) return [source({ fixtures: 10 })];
      if (url.startsWith('/api/pr/profile')) return profile;
      return [];
    });
    renderApp(<Research />, '/research');
    await screen.findByRole('article', { name: 'Product 0' });
    expect(screen.getByText('10,000 matches · filtered and sorted on the server')).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(48);
    for (let n = 1; n <= 7; n++) {
      fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
      await waitFor(() => expect(calls(f, '/api/pr/products?').some((u) => u.endsWith(`cursor=${n}`))).toBe(true));
    }
    await screen.findByRole('button', { name: 'Show more' }); // 384 loaded
    // jsdom has no layout: one column of 434 px rows in a 768 px window, so rows 0–4 (3 below the fold).
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5));
    const grid = screen.getByRole('region', { name: 'Products' }).querySelector<HTMLElement>('.grid')!;
    grid.getBoundingClientRect = () => ({ top: -200 * 434 }) as DOMRect; // scrolled to row 200
    fireEvent.scroll(window);
    await screen.findByRole('article', { name: 'Product 200' });
    expect(screen.queryByRole('article', { name: 'Product 0' })).toBeNull();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Product 197', 'Product 198', 'Product 199', 'Product 200', 'Product 201', 'Product 202', 'Product 203', 'Product 204']); // rows 200–201 in view, 3 either side
    expect((grid.firstElementChild as HTMLElement).style.height).toBe(`${197 * 434}px`); // the spacer keeps the scroll height
    const c = screen.getByRole('article', { name: 'Product 200' });
    c.focus();
    fireEvent.keyDown(c, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Product 201' }));
  });

  it('a research profile that fails to load says so and retries; an empty view offers all matches', async () => {
    let down = true;
    stubApi((url) => {
      if (url.startsWith('/api/stores')) return [store];
      if (url.startsWith('/api/pr/products')) return page([]);
      if (url.startsWith('/api/pr/sources')) return [source({ fixtures: 10 })];
      if (url.startsWith('/api/pr/profile')) return down ? new Response(JSON.stringify({ error: 'database is locked' }), { status: 500 }) : profile;
      return [];
    });
    renderApp(<Research />, '/research?store=paws&view=flagged');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("The research profile didn't load (database is locked): ranking and Ship to wait for it. Try again");
    down = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Edit research profile' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Nothing in Flagged yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all matches' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).not.toContain('view='));
  });

  it('a long title is clamped to two lines with the whole title kept; an image that fails to load falls back to the icon', async () => {
    const long = `Reflective dog leash ${'with a very long supplier title '.repeat(8)}end`;
    api({ items: [card({ id: 'p1', title: long, imageListing: 'l1' })] });
    renderApp(<Research />, '/research?store=paws');
    const c = await screen.findByRole('article', { name: long });
    const h = within(c).getByRole('heading', { name: long });
    expect(h.className).toContain('line-clamp-2');
    expect(h.getAttribute('title')).toBe(long);
    const img = c.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/pr/listings/l1/image?store=paws');
    fireEvent.error(img);
    expect(c.querySelector('img')).toBeNull(); // the neutral icon stays, never a broken image
    expect(c.querySelector('.bg-bg-2\\/90')).toBeNull(); // the pills' photo backing goes with the photo
  });

  it('partial outage and stale data: the source that stopped answering, why, and when it last synced; other sources unaffected', async () => {
    api({ sources: [source({ access: 'verified', status: 'degraded', errorKind: 'server', lastError: 'CJ: no answer within 20 s', lastSuccessAt: '2026-10-27T09:30:00Z', products: 40 }), source({ id: 'trends_csv', name: 'Google Trends CSV', access: 'verified', products: 3 })] });
    renderApp(<Research />, '/research');
    await screen.findByRole('article', { name: 'Silicone grooming brush' });
    const banner = screen.getAllByRole('status').find((s) => s.textContent?.includes("isn't answering"))!;
    expect(banner.textContent).toBe(`CJdropshipping isn't answering (CJ: no answer within 20 s). Its products are from its last successful sync, ${new Date('2026-10-27T09:30:00Z').toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}; other sources are unaffected.`);
    expect(screen.getAllByRole('status').filter((s) => s.textContent?.includes('Google Trends CSV'))).toHaveLength(0);
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
    assessment: { fit: { fit: 'weak', reasons: ['battery', 'Missing price band'] }, demand: { level: 'moderate', sets: 1, ownOrders: false }, flags: [], confidence: { level: 'low', count: 1, has: { demand: true, offer: false, economics: false, report: false } }, economics: null, report: null },
    notes: null, agentEstimates: null, stores: [], ...o,
  });
  const set: PrDemandTab['sets'][number] = {
    id: 's1', platform: 'google_trends', query: 'dog brush', region: 'US', granularity: 'week', metric: 'interest_over_time', scope: 'product', origin: 'import', periodStart: '2024-11-03', periodEnd: '2026-10-25',
    retrievedAt: '2026-10-26T00:00:00Z', points: 3, demandClass: 'sustained', peakMonth: null, momentum: 1, links: [],
    series: [{ at: '2026-10-11', value: 48 }, { at: '2026-10-18', value: 52 }, { at: '2026-10-25', value: 50 }],
  };
  const offer: PrOffer = {
    id: 'o1', key: 'l1|v1|CJdropshipping|US', supplier: 'CJdropshipping', variant: 'M / Grey', sku: 'CJ-BRUSH-M', destination: 'US', quantity: 1, method: 'CJPacket', unitCost: 342, shipCost: null, currency: 'USD', deliveryMin: 6, deliveryMax: 12,
    processingDays: null, moq: null, shipsFrom: 'CN', stock: [{ warehouse: 'CN', units: 120 }], provenance: 'live', checkedAt: '2026-10-27T00:00:00Z', status: 'pending', reasons: ['Shipping cost unknown'],
  };
  const history: PrHistoryRow[] = [{ id: 'h1', storeId: 'paws', kind: 'stage', from: null, to: 'discovered', reason: 'Assigned from All stores', by: 'owner', at: '2026-10-27T00:00:00Z' }];
  const prTask = (o: Partial<PrTask> = {}): PrTask => ({
    id: 't1', storeId: 'paws', productId: 'p1', listingId: null, url: null, instructions: 'Evaluate this product for the store.', template: 'full_evaluation', mode: 'new', type: 'product_hunter',
    conversationId: 'c1', runId: 'r1', status: 'running', detail: null, canRetry: false, createdAt: '2026-10-28T10:42:00Z', updatedAt: '2026-10-28T10:44:00Z', ...o,
  });
  const tasks = [prTask(), prTask({ id: 't0', conversationId: 'c0', runId: 'r0', status: 'failed', detail: 'Claude had a server error.', canRetry: true })];
  const run = {
    id: 'r1', status: 'running', createdAt: '2026-10-28T10:42:00Z',
    transcript: [
      { type: 'tool_call', id: 'a', name: 'mcp__frontline__search_suppliers', input: { query: 'dog brush' } },
      { type: 'tool_result', id: 'a', output: 'sku,title', isError: false },
      { type: 'tool_call', id: 'b', name: 'mcp__frontline__WebFetch', input: { url: 'https://www.example.com/brush' } },
    ],
  };
  const real: PrReport['body'] = {
    recommendation: 'shortlist', summary: 'Worth a small test.', purpose: 'Removes pet hair.', customer_problem: 'Hair on the sofa.', store_fit: { fit: 'strong', why: 'Pet grooming is the niche.' },
    demand_evidence: 'Steady interest.', competitors: [{ name: 'Brushy', price: '$19.99', source: 'https://brushy.example/p' }], supplier_offers: [], risks: ['Bristles break.'], next_steps: ['Order a sample.'],
    evidence: [{ claim: 'CJ lists it at $3.42', kind: 'measured', source: '[offer:o1]' }], open_questions: ['Shipping time?'], would_change_if: 'A 20-day delivery.',
    proposals: [{ kind: 'ad_angle', text: 'No more hair on the sofa.' }], unknown_reasons: { supplier_offers: 'No offer verified yet.' },
  };
  const unknown = (note: string | null = null) => ({ value: null, tag: null, note });
  const econ: PrEconomics = {
    currency: 'USD', rateDate: null, updatedAt: null, saved: { base: {}, conservative: {}, optimistic: {} },
    derived: {
      price: unknown('Needs a selling price'), discountPct: { value: 0, tag: 'assumption', note: 'No discount' },
      supplierCost: { value: 342, tag: 'verified', note: 'CJdropshipping · live · checked 2026-10-27' }, shipping: { value: 410, tag: 'verified', note: 'CJdropshipping · live · checked 2026-10-27' },
      feePercent: { value: 2.9, tag: 'owner', note: 'Store settings' }, feePerOrder: { value: 30, tag: 'owner', note: 'Store settings' }, duties: unknown('Unknown by default'),
      returnRatePct: { value: 0, tag: 'assumption', note: 'No returns' }, refundPct: { value: 100, tag: 'assumption', note: 'Full refund on a return' }, returnCost: unknown(), otherCosts: unknown(), adCost: unknown(),
    },
  };
  const noOutcomes: PrOutcomes = { currency: 'USD', research: null, assumed: null, audience: null, products: [], experiments: [], lessons: [] };
  const brief: PrBrief = {
    fields: { targetCustomer: 'Dog owners who hike', offerHypothesis: '', creativeConcepts: '- No more fur on the sofa.', measurementPlan: '', budgetAssumptions: '', decisionCriteria: '' },
    from: { targetCustomer: 'Research profile', creativeConcepts: 'Proposal: report of Oct 28, 2026' },
    updatedAt: null,
  };
  const matches: PrMatches = {
    listings: [{ id: 'l1', title: 'Silicone grooming brush', supplier: 'CJdropshipping', mergedFrom: null }, { id: 'l9', title: 'Grooming brush', supplier: 'Acme', mergedFrom: 'p9' }],
    candidates: [
      { listingId: 'l2', productId: 'p2', title: 'Pet deshedding comb', supplier: 'Acme', category: 'Pet Supplies > Grooming', fixture: false, verdict: 'exact', by: 'rule', matching: ['GTIN 0123', 'Category'], differing: ['Title', 'Supplier'], costShip: 550, fulfillment: 'verified' },
      { listingId: 'l3', productId: 'p3', title: 'Self-cleaning grooming brush', supplier: 'Brushco', category: null, fixture: false, verdict: 'similar', by: 'rule', matching: ['Title words: grooming, brush'], differing: ['Title', 'Supplier'], costShip: null, fulfillment: null },
      { listingId: 'l4', productId: 'p4', title: 'Grooming glove', supplier: 'Glovy', category: null, fixture: false, verdict: 'separate', by: 'owner', matching: [], differing: ['Title'], costShip: null, fulfillment: null },
    ],
    inStore: [{ id: 's1', title: 'Grooming Brush for Dogs', linked: false, matching: ['Title words: grooming, brush'] }],
    cj: false,
  };
  const reports: PrReport[] = [
    { id: 'rep2', taskId: 't1', runId: 'r1', conversationId: 'c1', runtime: 'claude', demo: false, createdAt: '2026-10-28T11:00:00Z', body: real },
    { id: 'rep1', taskId: 't0', runId: 'r0', conversationId: 'c0', runtime: 'demo', demo: true, createdAt: '2026-10-27T11:00:00Z', body: { ...real, recommendation: 'reject', summary: 'Demo engine: scripted example.' } },
  ];
  const panelApi = (d = detail(), more: (url: string, init?: RequestInit) => unknown = () => undefined) =>
    stubApi((url, init) => {
      const r = more(url, init);
      if (r !== undefined) return r;
      if (url.startsWith('/api/stores')) return [store, { ...store, id: 'glow', name: 'Glow Haus' }];
      if (url.startsWith('/api/pr/products?')) return page([card()]);
      if (url.includes('/demand?')) return { sets: [set], suggested: [{ ...set, id: 's2', scope: 'query' }], notes: [] } satisfies PrDemandTab;
      if (url.includes('/offers?')) return [offer];
      if (url.includes('/history?')) return history;
      if (url.includes('/reports?')) return reports;
      if (url.includes('/economics?')) return econ;
      if (url.includes('/matches')) return matches;
      if (url.includes('/links')) return { links: [{ kind: 'store_product', refId: 's1', label: 'Grooming Brush (draft)', at: '2026-10-28T10:00:00Z' }], experiments: [{ id: 'e1', label: 'Brush hooks: ctr (planned)' }] } satisfies PrLinks;
      if (url.includes('/brief?')) return brief;
      if (url.includes('/outcomes?')) return noOutcomes;
      if (url.includes('/draft-product?')) return { id: 'ap1', title: 'Add "Silicone grooming brush" to Pawsome Gear as a draft' };
      if (url.includes('/owner?')) return { owner: 'Cody' };
      if (url.includes('/store-products?')) return { ruledOut: true };
      if (url.includes('/retry?')) return { ...tasks[1], status: 'queued' };
      if (url.startsWith('/api/pr/tasks?')) return tasks;
      if (url.startsWith('/api/runs/')) return run;
      if (url.startsWith('/api/conversations/')) return {};
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
    expect(within(panel).getAllByText('Not assessed yet')).toHaveLength(2); // economics until PR-18, differentiation until a real report
    expect(within(panel).getByText('Evidence confidence: Low')).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'Economics' })).toBeTruthy();
    expect(within(panel).queryByRole('combobox', { name: 'Assign to a store' })).toBeNull(); // store scope
    expect(screen.getByTestId('where').textContent).toContain('product=p1');
    fireEvent.click(within(panel).getByRole('button', { name: 'Research with an agent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Research a Product' });
    expect(within(dialog).getByText('Silicone grooming brush')).toBeTruthy(); // filled in
    expect(within(dialog).queryByRole('textbox', { name: 'Product link' })).toBeNull();
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

  it('Economics: three scenarios from one set of inputs, each tagged; a scenario changes only what the owner sets; Save sends the figures', async () => {
    const f = panelApi();
    renderApp(<Research />, '/research?store=paws&product=p1&tab=economics');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const row = (name: string) => within(within(panel).getByRole('row', { name: new RegExp(`^${name}`) })).getAllByRole('cell').map((c) => c.textContent);
    expect(await within(panel).findByText('Needs a selling price', { selector: 'p' })).toBeTruthy();
    expect(row('Contribution before ads')).toEqual(['Incomplete', 'Incomplete', 'Incomplete']); // never a 0
    expect(within(panel).getAllByText('Verified')).toHaveLength(2);
    const box = (name: string) => within(panel).getByRole('textbox', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });

    fireEvent.change(box('Selling price (USD)'), { target: { value: '29.99' } });
    expect(row('Contribution before ads')).toEqual(['$21.30', '$21.30', '$21.30']); // 2999 − 342 − 410 − (87 + 30)
    expect(row('Contribution after ads')).toEqual(['Needs ad cost', 'Needs ad cost', 'Needs ad cost']);
    expect(row('Break-even ROAS')).toEqual(['1.41×', '1.41×', '1.41×']);
    expect(within(panel).getAllByText('same as base')).toHaveLength(2);
    expect(within(panel).getByText('Duties, Other variable costs: unknown, so left out (figures are excl. them)')).toBeTruthy();

    fireEvent.click(within(panel).getByRole('radio', { name: 'Conservative' }));
    fireEvent.change(box('Return rate (%)'), { target: { value: '10' } });
    fireEvent.change(box('Cost per return (USD)'), { target: { value: '5' } });
    expect(row('Contribution before ads')).toEqual(['$17.80', '$21.30', '$21.30']); // 300 refunded, 50 a return on average
    expect(within(panel).getAllByText('same as base')).toHaveLength(1);
    fireEvent.change(box('Discount (%)'), { target: { value: 'ten' } });
    expect(within(panel).getByRole('alert').textContent).toBe('Conservative: Discount must be a percentage from 0 to 100');
    expect((within(panel).getByRole('button', { name: 'Save assumptions' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box('Discount (%)'), { target: { value: '' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save assumptions' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/economics?store=paws').some((u) => u)).toBe(true));
    expect(JSON.parse(String(f.mock.calls.find(([u, i]) => String(u).includes('/economics?') && i?.method === 'PUT')![1]!.body))).toEqual({
      base: { price: 2999 }, conservative: { returnRatePct: 10, returnCost: 500 }, optimistic: {},
    });
  });

  it('Compare: the panel fills the tray; the comparison sets products side by side on one ship-to, missing as missing, with shared figures; Save keeps it', async () => {
    const offer2 = { variant: 'M', method: 'CJPacket', quantity: 1, checkedAt: '2026-10-27T00:00:00Z', supplier: 'CJdropshipping', deliveryMax: 10, shipsFrom: 'CN' };
    const p2 = detail({
      card: card({ id: 'p2', title: 'Paw cleaner cup', fixture: false, costShip: 752, fulfillment: { status: 'verified', reasons: [], checkedAt: '2026-10-27T00:00:00Z' }, conditions: offer2 }),
      assessment: { ...detail().assessment, fit: null, demand: { level: 'none', sets: 0, ownOrders: false }, flags: [{ id: 'restricted:batteries', kind: 'restricted', label: 'Batteries', reason: '"battery" in the title' }] },
    });
    const econ2: PrEconomics = { ...econ, derived: { ...econ.derived, price: { value: 2499, tag: 'owner', note: "Your store's price" }, discountPct: { value: 10, tag: 'owner', note: null } } };
    const saved: PrComparison[] = [];
    const f = panelApi(detail(), (url, init) => {
      if (url.startsWith('/api/pr/comparisons')) {
        if (init?.method !== 'POST') return saved;
        saved.push({ ...(JSON.parse(String(init.body)) as PrComparison), id: 'cmp1', destination: 'US', currency: 'USD', createdAt: '2026-10-28T12:00:00Z', updatedAt: '2026-10-28T12:00:00Z' });
        return saved[0];
      }
      if (url.startsWith('/api/pr/products/p2/economics')) return econ2;
      if (url.startsWith('/api/pr/products/p2?')) return p2;
      return undefined;
    });
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Compare' }));
    expect(within(panel).getByRole('button', { name: 'Remove from comparison' })).toBeTruthy();
    const tray = await screen.findByRole('region', { name: 'Comparison' });
    expect(within(tray).getByText('Compare 1 of 4')).toBeTruthy();
    expect((within(tray).getByRole('button', { name: 'Open comparison' }) as HTMLButtonElement).disabled).toBe(true); // 2 or more
    localStorage.setItem('fe.research.compare', JSON.stringify({ paws: ['p1', 'p2'] })); // the second from its own panel
    cleanup();
    renderApp(<Research />, '/research?store=paws');
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Comparison' })).findByRole('button', { name: 'Open comparison' }));

    const dialog = await screen.findByRole('dialog', { name: 'Compare products' });
    await within(dialog).findByText('Paw cleaner cup');
    const row = (name: string) => within(within(dialog).getByRole('row', { name: new RegExp(`^${name}`) })).getAllByRole('cell').map((c) => c.textContent);
    await waitFor(() => expect(row('Selling price')).toEqual(['Missing: Needs a selling price', '$24.99']));
    expect(row('Store fit')).toEqual(['Weak: battery', 'Missing: Not assessed yet']);
    expect(row('Demand evidence')).toEqual(['Moderate · 1 set', 'Missing: No qualifying demand set']);
    expect(row('Cost')).toEqual(['Missing: Fixture offer: not verified', '$7.52 · Fulfillment verified for selected conditions']);
    expect(row('Shipping')).toEqual(['Missing: No offer for this ship-to', 'CJPacket · up to 10 days · from China']);
    expect(row('Risks')).toEqual(['No flags found (rule checks only), no report risks', 'Batteries']);
    expect(row('Contribution before ads')).toEqual(['Missing: Selling price', '$14.02']); // 10% off 2499 = 2249; − 342 − 410 − (65 + 30)
    expect(within(dialog).getByText(/Not like for like yet: the products' own discount differ/)).toBeTruthy();

    const box = (name: string) => within(dialog).getByRole('textbox', { name: new RegExp(`^${name}`) });
    fireEvent.change(box('Discount'), { target: { value: '0' } });
    fireEvent.change(box('Advertising cost'), { target: { value: '8' } });
    expect(row('Contribution before ads')[1]).toBe('$16.45'); // the same terms: 2499 − 342 − 410 − (72 + 30)
    expect(row('Contribution after ads')[1]).toBe('$8.45');
    expect(within(dialog).queryByText(/Not like for like yet/)).toBeNull();
    fireEvent.change(box('Name'), { target: { value: 'Grooming picks' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save comparison' }));
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => String(u) === '/api/pr/comparisons?store=paws' && i?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(f.mock.calls.find(([, i]) => i?.method === 'POST')![1]!.body))).toEqual({ name: 'Grooming picks', productIds: ['p1', 'p2'], figures: { discountPct: 0, adCost: 800 } });
    expect(await within(dialog).findByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete Grooming picks' })).toBeTruthy();
  });

  it('Overview: owner and links; Draft test brief prefilled from stored data, saved, a draft product requested, or drafted with an agent', async () => {
    const f = panelApi(detail({ owner: null }));
    const sent = (part: string, method: string) => JSON.parse(String(f.mock.calls.find(([u, i]) => String(u).includes(part) && i?.method === method)?.[1]?.body ?? 'null'));
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const owner = await within(panel).findByRole('textbox', { name: 'Owner' });
    fireEvent.change(owner, { target: { value: ' Cody ' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save owner' }));
    await waitFor(() => expect(bodyOf(f, '/owner?')).toEqual({ owner: 'Cody' }));
    expect((await within(panel).findByRole('list', { name: 'Linked' })).textContent).toContain('Store product: Grooming Brush (draft)');
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Link an experiment' }), { target: { value: 'e1' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(sent('/links?', 'POST')).toEqual({ kind: 'experiment', refId: 'e1' }));

    fireEvent.click(within(panel).getByRole('button', { name: 'Draft test brief' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test brief' });
    expect(await within(dialog).findByDisplayValue('Dog owners who hike')).toBeTruthy();
    expect(within(dialog).getByText('Research profile')).toBeTruthy();
    expect(within(dialog).getByText('Proposal: report of Oct 28, 2026')).toBeTruthy();
    expect((within(dialog).getByRole('textbox', { name: 'Offer hypothesis' }) as HTMLTextAreaElement).value).toBe(''); // nothing stored: empty
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Decision criteria' }), { target: { value: 'Stop at $40 without a sale' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save brief' }));
    await waitFor(() => expect(sent('/brief?', 'PUT')).toEqual({ fields: { ...brief.fields, decisionCriteria: 'Stop at $40 without a sale' } }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare draft product' }));
    expect((await within(dialog).findByRole('status')).textContent).toBe('Approval requested: Add "Silicone grooming brush" to Pawsome Gear as a draft. Approve it from the bell to make the draft.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Draft with an agent' }));
    const research = await screen.findByRole('dialog', { name: 'Research a Product' });
    expect(within(research).getByRole('button', { name: 'Test brief' }).getAttribute('aria-pressed')).toBe('true');
    expect((within(research).getByRole('textbox', { name: 'Instructions' }) as HTMLTextAreaElement).value).toMatch(/^Draft a test brief for this product/);
  });

  it("Overview: Outcomes compares what sold with what was assumed, with its context, and saves a measured period to the KB", async () => {
    const outcomes: PrOutcomes = {
      currency: 'USD', research: { recommendation: 'shortlist', at: '2026-09-20T00:00:00Z' }, assumed: { price: 2900, contribution: 1200, breakEvenRoas: 2.42 }, audience: 'Dog owners who hike',
      products: [
        {
          storeProductId: 'sp1', title: 'Paw Cup', status: 'active', test: { addedOn: '2026-10-01', approvalId: 'ap1', judgedAt: null }, period: { from: '2026-10-01', to: '2026-10-28' },
          offer: { price: 1999, compareAt: 2499 }, inventory: 40, observed: { units: 5, revenue: 10000, profit: 6000, uncosted: false, pricePerUnit: 2000, profitPerUnit: 1200 },
        },
        { storeProductId: 'sp2', title: 'Paw Cup XL', status: 'draft', test: null, period: { from: '2026-10-28', to: '2026-10-28' }, offer: { price: 2499, compareAt: null }, inventory: 0, observed: null },
      ],
      experiments: [{ id: 'e1', label: 'Paw Cup hooks: ctr', status: 'worked', result: 'B beat A on CTR' }],
      lessons: [{ cardId: 'k1', title: 'Silicone grooming brush: Rejected (Oct 1, 2026)', stage: 'hypothesis' }],
    };
    const f = panelApi(detail(), (url) => (url.includes('/outcomes/sp1/knowledge?') ? { cardId: 'k2' } : url.includes('/outcomes?') ? outcomes : undefined));
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const section = within(await within(panel).findByRole('region', { name: 'Outcomes' }));
    await section.findByText('Research said: Shortlist for testing (Sep 20, 2026).');
    section.getByText('Assumed (base economics): $29.00 selling price, $12.00 contribution before ads per order.');
    const sold = within(section.getByRole('article', { name: 'Outcome: Paw Cup' }));
    sold.getByText('5 sold, $100.00 revenue, $60.00 profit after unit cost and store fees.');
    sold.getByText('Per unit: $20.00 revenue (assumed $29.00), $12.00 profit before shipping, returns and ads (assumed $12.00 contribution before ads).');
    expect(sold.getByText(/^Context: offer \$19\.99 \(compare at \$24\.99\), inventory 40, audience Dog owners who hike;/)).toBeTruthy();
    within(section.getByRole('article', { name: 'Outcome: Paw Cup XL' })).getByText("A demo store's orders are generated: they never count as outcomes.");
    expect(within(section.getByRole('article', { name: 'Outcome: Paw Cup XL' })).queryByRole('button')).toBeNull(); // nothing measured: nothing to save
    section.getByText('Experiment Paw Cup hooks: ctr: worked, B beat A on CTR');
    expect(section.getByRole('link', { name: 'Silicone grooming brush: Rejected (Oct 1, 2026)' }).getAttribute('href')).toBe('/knowledge?card=k1');
    fireEvent.click(sold.getByRole('button', { name: 'Save outcome to Knowledge Base' }));
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => String(u) === '/api/pr/products/p1/outcomes/sp1/knowledge?store=paws' && i?.method === 'POST')).toBe(true));
  });

  it('Research: Ask a specialist starts a team from stored facts, links it, and shows its assignments and consolidated answer', async () => {
    const plan: PrSpecialistTeam = { title: 'Silicone grooming brush: positioning', objective: 'Asked from Product Research about "Silicone grooming brush". Ad Strategist: propose the positioning…', participants: [{ type: 'product_hunter' }, { type: 'ad_strategist' }] };
    const team: SquadMission = {
      id: 'tm1', storeId: 'paws', title: plan.title, createdAt: '2026-10-28T12:00:00Z', status: 'done', conversationId: 'cv9',
      participants: [{ configId: 'c1', name: 'Product Researcher', type: 'product_hunter' }, { configId: 'c2', name: 'Ad Strategist', type: 'ad_strategist' }],
      steps: [
        { id: 'plan', kind: 'plan', role: 'product_hunter', task: 'Plan', dependsOn: [], status: 'done' },
        { id: 's1', kind: 'task', role: 'ad_strategist', task: 'Three ad angles for hikers', dependsOn: ['plan'], status: 'done', deliverable: 'Leak-proof on the trail' },
        { id: 'syn', kind: 'synthesis', role: 'product_hunter', task: 'Consolidate', dependsOn: ['s1'], status: 'done', deliverable: 'Lead with leak-proof; test on hikers first' },
      ],
    };
    let linked = false;
    const f = panelApi(detail(), (url, init) => {
      if (url.includes('/specialist?')) return plan;
      if (url === '/api/teams?store=paws') return team;
      if (url.startsWith('/api/teams/tm1?')) return team;
      if (url.includes('/links') && init?.method === 'POST') return (linked = true), { links: [], experiments: [] };
      if (url.includes('/links')) return { links: linked ? [{ kind: 'team', refId: 'tm1', label: plan.title, at: '2026-10-28T12:00:00Z' }] : [], experiments: [] } satisfies PrLinks;
      return undefined;
    });
    const sent = (part: string, method: string) => JSON.parse(String(f.mock.calls.find(([u, i]) => String(u).includes(part) && i?.method === method)?.[1]?.body ?? 'null'));
    renderApp(<Research />, '/research?store=paws&product=p1&tab=research');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const ask = within(await within(panel).findByRole('region', { name: 'Ask a specialist' }));
    fireEvent.click(ask.getByRole('button', { name: 'Ad Strategist: positioning' }));
    await ask.findByText(plan.objective);
    expect(f.mock.calls.some(([u]) => String(u) === '/api/pr/products/p1/specialist?store=paws&ask=positioning')).toBe(true);
    fireEvent.click(ask.getByRole('button', { name: 'Start team' }));
    await waitFor(() => expect(sent('/links', 'POST')).toEqual({ kind: 'team', refId: 'tm1' }));
    expect(sent('/api/teams?store=paws', 'POST')).toMatchObject({ title: plan.title, objective: plan.objective, participants: plan.participants });
    const summary = within(await ask.findByRole('article', { name: `Team: ${plan.title}` }));
    expect(summary.getByText('Done')).toBeTruthy();
    expect(summary.getByRole('list', { name: 'Assignments' }).textContent).toContain('Ad Strategist: Three ad angles for hikers · done → Leak-proof on the trail');
    expect(summary.getByText('Consolidated: Lead with leak-proof; test on hikers first')).toBeTruthy();
    expect(summary.getByRole('link', { name: 'Open the team in AI Agents' }).getAttribute('href')).toBe('/agents/c/cv9?store=paws');
  });

  it('Research: 500 tasks and as many reports show the latest, then the first 10 of each until Show all', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ...tasks[1]!, id: `t${i}`, instructions: `Task ${i}` }));
    const lots = Array.from({ length: 500 }, (_, i) => ({ ...reports[0]!, id: `r${i}` }));
    panelApi(detail(), (url) => (url.startsWith('/api/pr/tasks?') ? many : url.includes('/reports?') ? lots : undefined));
    renderApp(<Research />, '/research?store=paws&product=p1&tab=research');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    await within(panel).findByText('Earlier tasks (499)');
    expect(within(panel).getAllByText(/^“Task \d+”$/)).toHaveLength(11); // the latest and 10 earlier
    expect(within(panel).getByText('Reports (500)')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Show all 499 earlier tasks' }));
    expect(within(panel).getAllByText(/^“Task \d+”$/)).toHaveLength(500);
    expect(within(panel).getByRole('button', { name: 'Show all 500 reports' })).toBeTruthy();
  });

  it('Research: a long run shows its latest 6 steps numbered where they fall, and Show all lists every step', async () => {
    const many = { ...run, status: 'done', transcript: Array.from({ length: 8 }, (_, i) => [{ type: 'tool_call', id: `s${i}`, name: 'mcp__frontline__search_suppliers', input: { query: `brush ${i}` } }, { type: 'tool_result', id: `s${i}`, output: 'sku', isError: false }]).flat() };
    panelApi(detail(), (url) => (url.startsWith('/api/runs/') ? many : undefined));
    renderApp(<Research />, '/research?store=paws&product=p1&tab=research');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const activity = await within(panel).findByRole('list', { name: 'Activity' });
    expect(activity.getAttribute('start')).toBe('3');
    expect(within(activity).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([2, 3, 4, 5, 6, 7].map((i) => `Searched suppliers for "brush ${i}"`));
    fireEvent.click(within(panel).getByRole('button', { name: 'Show all 8 steps' }));
    expect(within(activity).getAllByRole('listitem')).toHaveLength(8);
    expect(activity.getAttribute('start')).toBe('1');
    expect(within(panel).queryByRole('button', { name: 'Show all 8 steps' })).toBeNull();
  });

  it("History: the owner's stage decisions save to the Knowledge Base (once, then linked); a task's move doesn't", async () => {
    const rows: PrHistoryRow[] = [
      { id: 'h3', storeId: 'paws', kind: 'stage', from: 'researching', to: 'rejected', reason: 'Leaks', by: 'owner', at: '2026-10-28T12:00:00Z' },
      { id: 'h2', storeId: 'paws', kind: 'stage', from: 'discovered', to: 'researching', reason: 'A research task started', by: 't1', at: '2026-10-28T11:00:00Z' },
      { id: 'h1', storeId: 'paws', kind: 'stage', from: null, to: 'discovered', reason: 'Assigned from All stores', by: 'owner', at: '2026-10-27T00:00:00Z', cardId: 'k1' },
    ];
    const f = panelApi(detail(), (url) => (url.includes('/history?') ? rows : url.includes('/knowledge?') ? { cardId: 'k2' } : undefined));
    renderApp(<Research />, '/research?store=paws&product=p1&tab=history');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const saves = await within(panel).findAllByRole('button', { name: 'Save decision to Knowledge Base' });
    expect(saves).toHaveLength(1); // h3 only: h2 is the task's, h1 is saved already
    expect(within(panel).getByRole('link', { name: 'In the Knowledge Base' }).getAttribute('href')).toBe('/knowledge?card=k1');
    fireEvent.click(saves[0]!);
    await waitFor(() => expect(f.mock.calls.some(([u, i]) => String(u) === '/api/pr/products/p1/history/h3/knowledge?store=paws' && i?.method === 'POST')).toBe(true));
  });

  it('Watchlist: each watch with its last successful check, partial coverage and alerts; watch a niche, set preferences, check now; watch an offer', async () => {
    const watch = (o: Partial<PrWatch>): PrWatch => ({
      id: 'w1', storeId: 'paws', kind: 'product', targetId: 'p1', label: 'Silicone grooming brush', productId: 'p1', prefs: { priceChangePct: 10, stockOut: true, newEvidence: true, shippingChange: true },
      lastCheckedAt: '2026-10-28T09:00:00Z', lastSuccessAt: '2026-10-28T09:00:00Z', lastError: null, coverage: "CJdropshipping isn't connected: compared with stored offers only", alerts: [], ...o,
    });
    const watches = [
      watch({ alerts: [{ id: 'a1', kind: 'price', title: 'Cost + ship to US up 13%', body: '$8.00 → $9.00, excl. duties', createdAt: '2026-10-28T09:00:00Z' }] }),
      watch({ id: 'w2', storeId: null, kind: 'niche', targetId: 'Pet Supplies > Grooming', label: 'Pet Supplies > Grooming', productId: null, coverage: null, lastError: 'CJdropshipping: CJ: refused', lastSuccessAt: null }),
    ];
    const f = panelApi(detail(), (url) => (url.startsWith('/api/pr/watches') ? watches : undefined));
    renderApp(<Research />, '/research?store=paws&view=watchlist');
    const list = await screen.findByRole('region', { name: 'Watches' });
    const mine = await within(list).findByRole('article', { name: 'Watch: Silicone grooming brush' });
    expect(mine.textContent).toContain('Last successful check Oct 28, 2026');
    expect(mine.textContent).toContain("Partial coverage: CJdropshipping isn't connected: compared with stored offers only");
    expect(mine.textContent).toContain('Cost + ship to US up 13% · $8.00 → $9.00, excl. duties');
    const niche = within(list).getByRole('article', { name: 'Watch: Pet Supplies > Grooming' });
    expect(niche.textContent).toContain('No successful check yet');
    expect(niche.textContent).toContain('Last check failed');
    expect(within(niche).getByText('Change it in All stores')).toBeTruthy(); // the all-stores list isn't this store's to change
    expect(within(niche).queryByRole('button', { name: 'Check now' })).toBeNull();

    const posted = (path: string, method = 'POST') => f.mock.calls.filter(([u, i]) => String(u).startsWith(path) && i?.method === method).map(([, i]) => JSON.parse(String(i!.body)));
    fireEvent.change(within(list).getByRole('combobox', { name: 'Niche to watch' }), { target: { value: 'Pet Supplies > Grooming' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Watch niche' }));
    await waitFor(() => expect(posted('/api/pr/watches?store=paws')).toEqual([{ kind: 'niche', targetId: 'Pet Supplies > Grooming' }]));
    fireEvent.click(within(mine).getByText('Alert on'));
    fireEvent.change(within(mine).getByRole('spinbutton'), { target: { value: '25' } });
    fireEvent.click(within(mine).getByRole('checkbox', { name: 'New evidence' }));
    fireEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(posted('/api/pr/watches/w1?store=paws', 'PUT')).toEqual([{ id: 'w1', prefs: { priceChangePct: 25, stockOut: true, newEvidence: false, shippingChange: true } }]));
    fireEvent.click(within(mine).getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(posted('/api/pr/watches/w1/check?store=paws')).toEqual([{ id: 'w1' }]));

    fireEvent.click(within(mine).getByRole('button', { name: 'Silicone grooming brush' }));
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    fireEvent.click(await within(panel).findByRole('tab', { name: 'Suppliers' }));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Watch this offer' }));
    await waitFor(() => expect(posted('/api/pr/watches?store=paws')).toContainEqual({ kind: 'offer', targetId: 'l1|v1|CJdropshipping|US' }));
  });

  it('Suppliers: other suppliers marked Exact match or Similar with what matches and differs; merge, confirm, rule out, separate; and "Already in your store"', async () => {
    const f = panelApi();
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const inStore = (await within(panel).findByText('Already in Pawsome Gear')).parentElement!.parentElement!;
    await within(inStore).findByText('Possibly');
    expect(inStore.textContent).toContain('Grooming Brush for Dogs (Title words: grooming, brush)');
    fireEvent.click(within(inStore).getByRole('button', { name: 'Not this one: Grooming Brush for Dogs' }));
    await waitFor(() => expect(bodyOf(f, '/store-products?')).toEqual({ storeProductId: 's1', same: false }));

    fireEvent.click(within(panel).getByRole('tab', { name: 'Suppliers' }));
    const others = await within(panel).findByRole('region', { name: 'Other suppliers' });
    const exact = within(others).getByLabelText('Acme: Pet deshedding comb');
    expect(within(exact).getByText('Exact match')).toBeTruthy();
    expect(exact.textContent).toContain('Cost + ship: $5.50 · Fulfillment verified for selected conditions');
    expect(exact.textContent).toContain('Matching: GTIN 0123, Category. Differing: Title, Supplier.');
    const similar = within(others).getByLabelText('Brushco: Self-cleaning grooming brush');
    expect(within(similar).getByText('Similar')).toBeTruthy();
    expect(within(similar).queryByRole('button', { name: 'Merge into this product' })).toBeNull(); // only an exact match merges
    expect(within(others).getByText('Not the same product (1)')).toBeTruthy();
    expect(within(others).getByText('Connect CJdropshipping in Integrations to search its catalog for other suppliers too.')).toBeTruthy();

    const posted = (path: string) => f.mock.calls.filter(([u, i]) => String(u).startsWith(path) && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)));
    fireEvent.click(within(exact).getByRole('button', { name: 'Merge into this product' }));
    await waitFor(() => expect(posted('/api/pr/products/p1/matches/l2?store=paws')).toEqual([{ listing: 'l2', action: 'merge' }]));
    fireEvent.click(within(similar).getByRole('button', { name: 'Same product' }));
    await waitFor(() => expect(posted('/api/pr/products/p1/matches/l3?store=paws')).toEqual([{ listing: 'l3', action: 'same' }]));
    fireEvent.click(within(others).getByRole('button', { name: 'Separate' })); // the listing a merge brought in
    await waitFor(() => expect(posted('/api/pr/products/p1/matches/l9?store=paws')).toEqual([{ listing: 'l9', action: 'split' }]));
  });

  it('Overview shows the base economics per order before ads, excl. what is unknown', async () => {
    const figures = { orderValue: 2999, refunds: 0, netRevenue: 2999, fees: 117, variableCosts: 869, before: 2130, after: null, breakEvenRoas: 1.41 };
    panelApi(detail({ assessment: { ...detail().assessment, economics: { currency: 'USD', result: { missing: [], excluded: ['duties'], figures } } } }));
    renderApp(<Research />, '/research?store=paws&product=p1');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    expect(await within(panel).findByText('$21.30')).toBeTruthy();
    expect(within(panel).getByText('per order before ads, excl. duties')).toBeTruthy();
  });

  it('Research: the latest task with its real activity, Cancel run and Retry, then every report, the demo one labelled', async () => {
    const f = panelApi(detail({ assessment: { ...detail().assessment, report: { createdAt: '2026-10-28T11:00:00Z', risks: ['Bristles break.', 'Saturated.'], proposals: real.proposals } } }));
    renderApp(<Research />, '/research?store=paws&product=p1&tab=research');
    const panel = await screen.findByRole('complementary', { name: 'Product details' });
    const activity = await within(panel).findByRole('list', { name: 'Activity' });
    expect(within(activity).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Searched suppliers for "dog brush" ', 'Read example.com now']);
    expect(within(panel).getAllByRole('link', { name: 'Open conversation in AI Agents' })[0]!.getAttribute('href')).toBe('/agents/c/c1?store=paws');
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(calls(f, '/api/conversations/c1/stop?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/api/conversations/c1/stop')).toEqual({ runId: 'r1' });
    expect(within(panel).getByText('Claude had a server error.')).toBeTruthy(); // the earlier task, as it ended
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls(f, '/api/pr/tasks/t0/retry?store=paws')).toHaveLength(1));

    expect(within(panel).getByText('Reports (2)')).toBeTruthy();
    expect(within(panel).getByText('Shortlist for testing')).toBeTruthy();
    expect(within(panel).getAllByRole('button', { name: /^Move to/ }).map((b) => b.textContent)).toEqual(['Move to Shortlisted']); // never from the demo report
    fireEvent.click(within(panel).getByRole('button', { name: 'Move to Shortlisted' }));
    await waitFor(() => expect(calls(f, '/api/pr/products/p1/stage?store=paws')).toHaveLength(1));
    expect(bodyOf(f, '/stage?')).toMatchObject({ stage: 'shortlisted', reason: expect.stringMatching(/^Report of .+: Shortlist for testing$/) });
    expect(within(panel).getByText('Demo engine · scripted example, not research')).toBeTruthy();
    expect(within(panel).queryByText('Reject')).toBeNull(); // a demo report has no recommendation
    expect(within(panel).getByText('Proposals, not evidence')).toBeTruthy();
    expect(within(panel).getByText('Unknown: No offer verified yet.')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'https://brushy.example/p' }).getAttribute('rel')).toBe('noopener noreferrer');

    fireEvent.click(within(panel).getByRole('tab', { name: 'Overview' }));
    expect(await within(panel).findByText('Proposal, not evidence')).toBeTruthy();
    expect(within(panel).getByText('Ad angle: No more hair on the sofa.')).toBeTruthy();
    expect(within(panel).getByText('From the report of Oct 28, 2026: Bristles break; Saturated.')).toBeTruthy(); // never ".;"
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
    expect(within(panel).queryByRole('button', { name: 'Research with an agent' })).toBeNull(); // kept per store
  });
});
