// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, SA_METRICS, saDef, type SaListingRow, type SaMetricId, type SaMetricResult, type SaProductDetail, type SaValue } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERIOD = { preset: 'last30', from: '2026-09-30', to: '2026-10-29', days: 30, partial: false } as const;
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [{ kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const V = (value: number | null): SaValue => ({ value, status: 'ok' });
const row = (i: number, more: Partial<SaListingRow> = {}): SaListingRow => ({
  id: `p${i}`, title: `Product ${i}`, image: null, status: 'active', category: 'Skincare', sku: `SKU-${i}`, variants: 1, variantsOut: 0, price: 10, compareAt: null,
  stock: 38, stockState: 'low', coverDays: 5.1, channels: [], syncedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  netSales: V(100), units: V(5), refunds: V(0), refundRate: V(0), contribution: V(40), collections: [], costCoverage: V(1), ...more,
});
const ROWS = [row(1), row(2)];
const channel = (c: string, status: string | null, error: string | null = null, publishedAt: string | null = null) => ({ channel: c, status, error, syncedAt: null, publishedAt, units: V(1), netSales: V(1), refunds: V(0) });
const metric = (id: SaMetricId, value: number | null, previous: number | null, more: Partial<SaValue> = {}): SaMetricResult => ({ id, def: saDef(id), value, status: 'ok', ...more, previous: previous == null ? null : V(previous), change: changeOf(value, previous, SA_METRICS[id].unit) });
const point = (day: string, value: number | null, more = {}) => ({ from: day, to: day, value, status: value == null ? ('unavailable' as const) : ('ok' as const), previous: null, ...more });
const detail = (r: SaListingRow, more: Partial<SaProductDetail> = {}): SaProductDetail => ({
  period: PERIOD, compare: null, row: r,
  metrics: [metric('units', 201, 178), metric('net_sales', 8442, 7484), metric('refunds', 126, 90), metric('refund_rate', 0.015, 0.012), metric('contribution_before_ads', 4390, 4000), metric('cost_coverage', 1, 1)],
  units: { grain: 'day', points: [point('2026-10-27', 4), point('2026-10-28', null), point('2026-10-29', 6, { partial: true })] },
  channels: [channel('site', 'active', null, '2026-03-04'), channel('tiktok_shop', 'failed', 'Image under 600 px'), channel('amazon', null)],
  costs: { unitCost: { value: 13.2, source: 'shopify', since: '2026-08-02' }, fees: { value: 52.1, status: 'estimated', note: 'Estimate for 41 orders' }, feeRule: { percent: 2.9, perOrder: 0.3 } },
  variants: { rows: [] },
  insights: [{ rule: 'stock_cover@1', kind: 'business', tone: 'warn', title: `${r.title}: ~5 days of stock`, detail: '38 left · 7.4 sold a day over the last 14 days', evidence: {}, target: { kind: 'product', id: r.id } }],
  rules: [{ id: 'stock_cover@1', name: 'Low stock cover', when: 'Stock lasts under 10 days', minSample: '5 units', datasets: ['orders', 'inventory'], metrics: [] }],
  scope: { applied: [], ignored: [{ key: 'collection', reason: 'The drawer shows the one product' }] },
  ...more,
});

function render(path: string, more: Partial<SaProductDetail> = {}) {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/products/')) return detail(ROWS.find((r) => url.startsWith(`/api/analytics/products/${r.id}?`))!, more);
    if (url.startsWith('/api/analytics/listings'))
      return { period: PERIOD, status: 'active', sort: 'units:desc', page: 1, pageSize: 25, total: 2, counts: { active: 2, draft: 0, archived: 0, all: 2 }, variants: 2, channelListings: 0, rows: ROWS, scope: { applied: [], ignored: [] } };
    return [];
  });
  renderApp(<Analytics />, path);
  return fetch;
}
const where = () => screen.getByTestId('where').textContent!;

describe('Product drawer (SA-88)', () => {
  it('a Listings row opens it with its header facts and pills; Esc closes it and focus returns to the row', async () => {
    const fetch = render('/analytics?store=a&tab=listings&filters=%7B%22collection%22%3A%5B%22c1%22%5D%7D');
    const rows = (await screen.findAllByRole('row')).slice(1);
    rows[1]!.focus();
    fireEvent.keyDown(rows[1]!, { key: 'Enter' });
    expect(where()).toContain('product=p2');
    const d = await screen.findByRole('dialog', { name: 'Product 2' });
    expect(within(d).getByText('SKU-2 · Skincare · Shopify product p2')).toBeTruthy();
    const pills = [...d.querySelector('header')!.querySelectorAll('span.rounded-full')].map((x) => [x.textContent, x.getAttribute('title')]);
    expect(pills).toEqual([['Active on site', null], ['Failed on TikTok Shop', 'Image under 600 px'], ['38 in stock · ~5 days', null], ['Synced 6 min ago', null]]);
    expect(within(d).getByText(/Not applied here/).textContent).toContain('Collection (The drawer shows the one product)');
    expect(fetch.mock.calls.map((c) => decodeURIComponent(String(c[0]))).find((u) => u.startsWith('/api/analytics/products/p2?'))).toContain('filters={"collection":["c1"]}');
    expect([rows[0]!.getAttribute('aria-current'), rows[1]!.getAttribute('aria-current')]).toEqual([null, 'true']);

    within(d).getByRole('button', { name: 'Close' }).focus(); // as showModal does (jsdom's stub doesn't)
    fireEvent(d, new Event('cancel', { cancelable: true })); // what Esc sends a modal dialog
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).not.toContain('product=');
    expect(document.activeElement).toBe(rows[1]);
  });

  it('a link with product= opens it; a click on another row opens that one', async () => {
    render('/analytics?store=a&tab=listings&product=p1');
    expect(await screen.findByRole('dialog', { name: 'Product 1' })).toBeTruthy();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click((await screen.findAllByRole('row'))[2]!);
    expect(await screen.findByRole('dialog', { name: 'Product 2' })).toBeTruthy();
  });
});

describe('Performance tab (SA-89)', () => {
  const open = async (more: Partial<SaProductDetail> = {}) => {
    render('/analytics?store=a&tab=listings&product=p1', more);
    const d = await screen.findByRole('dialog', { name: 'Product 1' });
    return within(await within(d).findByRole('tabpanel', { name: 'Performance' }));
  };
  const text = (els: Iterable<Element>) => [...els].map((e) => e.textContent);

  it('the mini metrics, units a day with its summary and table, the Rule card, the channel table and the price line', async () => {
    const t = await open();
    expect(screen.getByRole('tab', { name: 'Performance' }).getAttribute('aria-selected')).toBe('true');
    expect(text(t.getByText('Net sales', { selector: 'dt' }).closest('dl')!.children)).toEqual(['Net sales$8,442▲ 12.8%', 'Units201▲ 12.9%', 'Contribution before ads$4,39052% of net sales', 'Refunds$1263 units · 1.5%']);
    expect(t.getByRole('img').getAttribute('aria-label')).toBe('Units sold per day, Oct 27 – Oct 29: 10 in all. Most on Oct 29, 6. 1 day not reported.');
    expect(t.getByRole('img').querySelectorAll('rect').length).toBe(2); // no bar for the day not reported
    expect(t.getByText(/Product views:/).textContent).toBe('Product views: not tracked');
    fireEvent.click(t.getByRole('button', { name: 'Table' }));
    expect(text(t.getByRole('table', { name: 'Units sold per day' }).querySelectorAll('tbody tr'))).toEqual(['Oct 274', 'Oct 28Not reported', 'Oct 29 · so far6']);
    expect(t.getByText('Low stock cover').parentElement!.textContent).toBe('RuleLow stock cover');
    expect(t.getByText(/7.4 sold a day/).textContent).toBe('38 left · 7.4 sold a day over the last 14 days. Flags when stock lasts under 10 days.');
    const rows = t.getByRole('table', { name: 'Channels' }).querySelectorAll('tbody tr');
    expect([...rows].map((tr) => text(tr.querySelectorAll('td')))).toEqual([
      ['SHShopify site', 'Active · since Mar 4', '1', '$1', '$0'],
      ['TKTikTok Shop', 'Failed', '1', '$1', '$0'],
      ['AZAmazon', 'Not listed', '1', '$1', '$0'],
    ]);
    expect(rows[1]!.querySelectorAll('td')[1]!.getAttribute('title')).toBe('Image under 600 px');
    expect(t.getByText(/^Price/).textContent).toBe('Price $10.00 · unit cost $13.20 (Shopify, since Aug 2) · fees 2.9% + $0.30 (estimate)');
  });

  it("missing values say why; recorded fees, no unit cost, no flag, a demo store's channels", async () => {
    const none = (note: string): Partial<SaValue> => ({ status: 'unavailable', reason: 'unsupported', note });
    const gone: SaValue = { value: null, status: 'unavailable', reason: 'unsupported', note: "Demo data isn't split by channel" };
    const t = await open({
      metrics: [metric('units', 3, null), metric('net_sales', 0, null), metric('refunds', 0, null), metric('refund_rate', null, null, none('No units')), metric('contribution_before_ads', null, null, none('No unit cost')), metric('cost_coverage', 0, null)],
      channels: [{ ...channel('site', 'active'), units: gone, netSales: gone, refunds: gone }],
      channelsNote: "Demo data isn't split by channel",
      costs: { unitCost: null, fees: { value: 8.17, status: 'ok' }, feeRule: { percent: 2.9, perOrder: 0.3 } },
      insights: [],
      rules: [],
    });
    expect(text(t.getByText('Net sales', { selector: 'dt' }).closest('dl')!.children)).toEqual(['Net sales$0', 'Units3', 'Contribution before adsNot supportedNo unit cost', 'Refunds$0']);
    expect(t.queryByText('Rule')).toBeNull();
    expect(t.getByText("Demo data isn't split by channel.")).toBeTruthy();
    expect(text(t.getByRole('table', { name: 'Channels' }).querySelectorAll('tbody td')).slice(2)).toEqual(['–', '–', '–']);
    expect(t.getByText(/^Price/).textContent).toBe('Price $10.00 · no unit cost · fees $8 (recorded)');
  });
});
