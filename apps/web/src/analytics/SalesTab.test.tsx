// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, saDef, SA_SALES_REPORT, type SaMetricId } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERIOD = { preset: 'custom', from: '2026-10-24', to: '2026-10-25', days: 2, partial: false };
const CTX = { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [{ kind: 'tiktok_shop', name: 'TikTok Shop', status: 'connected' }], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
const SCOPE = { applied: [], ignored: [] };
const VALUES: Record<string, number> = { gross_sales: 470, discounts: 16.4, refunds: 48.2, net_sales: 405.4, orders: 9, aov: 50.4, units: 14, cancelled_orders: 1 };
const metric = (id: SaMetricId) => ({ id, def: saDef(id), value: VALUES[id], status: 'ok', previous: { value: VALUES[id]! / 2, status: 'ok' }, change: changeOf(VALUES[id]!, VALUES[id]! / 2, 'money') });
const row = (from: string, net: number) => ({ from, to: from, values: Object.fromEntries(SA_SALES_REPORT.map((id) => [id, { value: id === 'net_sales' ? net : 1, status: 'ok' }])) });
const REPORT = {
  period: PERIOD, compare: null, today: '2026-10-31', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: SCOPE, grain: 'day',
  metrics: SA_SALES_REPORT.map(metric), tax: { value: 31.97, status: 'ok' }, shipping: { value: null, status: 'unavailable', reason: 'needs_ingestion', note: 'Synced before money parts' },
  rows: [row('2026-10-24', 300), row('2026-10-25', 105.4)],
};
const series = (id: string) => ({
  metric: id, def: saDef(id as SaMetricId), grain: 'day', period: PERIOD, compare: null, total: metric(id as SaMetricId), scope: SCOPE,
  points: [{ from: '2026-10-24', to: '2026-10-24', value: 300, status: 'ok', previous: null }, { from: '2026-10-25', to: '2026-10-25', value: 105.4, status: 'ok', previous: null }],
});
const BREAKDOWN: Record<string, unknown> = {
  channel: { rows: [{ id: 'site', label: 'site', net_sales: 375.4, units: 13 }, { id: 'tiktok_shop', label: 'tiktok_shop', net_sales: 30, units: 1 }, { id: null, label: 'Unknown', kind: 'unknown', net_sales: 0.5, units: 0 }] },
  product: { rows: [{ id: 'p1', label: 'Glow Serum', net_sales: 405.4, units: 14 }] },
  country: { rows: [], reason: 'needs_permission', note: "Shopify hasn't allowed reading the orders' shipping country (protected customer data)" },
};
const order = (id: string, more = {}) => ({ id, date: '2026-10-24', channel: 'site', status: 'paid', currency: 'USD', placed: true, estimated: false, gross: 68, discounts: 6.8, tax: 4.9, shipping: 4.99, refunds: null, net: 61.2, duplicateOf: null, counted: true, ...more });
const RECONCILE = {
  from: '2026-10-24', to: '2026-10-25', legacy: 470.37, net_sales: { value: 405.4, status: 'ok' }, unexplained: 0,
  lines: [
    { key: 'tax', label: 'Tax in current totals', amount: -31.97, count: 2, ids: ['#1003', '#1004'] },
    { key: 'channel_daily', label: "Amazon's daily totals (v1 counts its orders instead)", amount: -33, count: 2 },
  ],
  info: [{ key: 'excluded', label: 'Test, unpaid or voided orders, left out of both', amount: 45, count: 1, ids: ['#1006'] }],
  dedupe: { channels: [{ channel: 'tiktok_shop', matched: 1, unmatched: 1, outside: 0, ids: { matched: ['#1009'], unmatched: ['#1010'], outside: [] } }], unmapped: 0, unmappedIds: [], lines: [] },
};

function render(path: string) {
  const fetch = stubApi((url) => {
    const q = new URL(url, 'http://x').searchParams;
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/context')) return CTX;
    if (url.startsWith('/api/analytics/series')) return series(q.get('metric')!);
    if (url.startsWith('/api/analytics/sales/breakdown')) return { by: q.get('by'), period: PERIOD, total: { net_sales: metric('net_sales'), units: metric('units') }, scope: SCOPE, ...(BREAKDOWN[q.get('by')!] as object) };
    if (url.startsWith('/api/analytics/sales')) return q.get('grain') === 'week' ? { ...REPORT, grain: 'week', rows: [{ ...row('2026-10-24', 405.4), to: '2026-10-30' }] } : REPORT;
    if (url.startsWith('/api/analytics/reconcile')) return RECONCILE;
    if (url.startsWith('/api/analytics/orders') && q.get('ids'))
      return { period: PERIOD, total: metric('net_sales'), count: 1, page: 1, pageSize: 50, scope: SCOPE, rows: [order('#1006', { status: 'test', counted: false, net: null })] };
    if (url.startsWith('/api/analytics/orders'))
      return { period: PERIOD, total: metric('net_sales'), count: 60, page: Number(q.get('page')), pageSize: 50, scope: SCOPE, rows: [order('#1003'), order('#1009', { channel: 'tiktok_shop', net: null, duplicateOf: 'tt-1' }), order('#1001', { placed: false, gross: null, discounts: null, tax: null, shipping: null, refunds: 20, net: -20, date: '2026-10-20' })] };
    if (url.startsWith('/api/analytics/products/')) return new Response('{}', { status: 500 }); // the drawer's own test covers it
    if (url.startsWith('/api/analytics/contributions')) return { change: 0, rows: [], scope: SCOPE };
    if (url.startsWith('/api/analytics/insights')) return { insights: [], rules: [] };
    if (url.startsWith('/api/analytics/listings')) return { rows: [], scope: SCOPE };
    if (url.startsWith('/api/analytics/overview'))
      return { ...REPORT, channels: [], annotations: 0, attention: 0, metrics: (['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'] as const).map((id) => ({ ...metric(id), value: 1 })) };
    return [];
  });
  renderApp(<Analytics />, path);
  const calls = (to: string) => fetch.mock.calls.map((c) => decodeURIComponent(String(c[0]))).filter((u) => u.startsWith(`/api/analytics/${to}?`));
  return { calls };
}
const where = () => decodeURIComponent(screen.getByTestId('where').textContent!);
const drill = () => new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]).get('orders');

describe('Sales tab (SA-98)', () => {
  it('the bridge with tax and shipping apart, the KPIs, and the refunds view labelling what refunds change', async () => {
    const { calls } = render('/analytics?store=a&tab=sales');
    const bridge = await screen.findByRole('region', { name: 'Net sales bridge' });
    expect([...bridge.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Gross sales', '− Discounts', '− Refunds· refund day', '= Net sales· refund day', 'Tax charged (apart)', 'Shipping charged (apart)']);
    expect(within(bridge).getByText('$405')).toBeTruthy();
    expect(within(bridge).getByText('$32')).toBeTruthy(); // tax, rounded like the other money tiles
    expect(within(bridge).getByText('Not synced yet')).toBeTruthy(); // shipping unavailable says why, never $0
    const kpis = screen.getByRole('region', { name: 'Orders and units' });
    expect(within(kpis).getByText('Cancelled orders')).toBeTruthy();
    expect(within(kpis).queryByText('Gross sales')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: "Order's day" }));
    await waitFor(() => expect(calls('sales').at(-1)).toContain('refunds=order_day'));
    expect(where()).toContain('refunds=order_day');
    expect(within(screen.getByRole('region', { name: 'Net sales bridge' })).getAllByText('· order day')).toHaveLength(2);
  });

  it('rows by day, week or month; a row, a chart day or a table day opens the orders behind it, a page at a time', async () => {
    const { calls } = render('/analytics?store=a&tab=sales');
    const rows = await screen.findByRole('table', { name: 'Sales by day' });
    fireEvent.click(within(rows).getByRole('button', { name: 'Oct 24' }));
    const d = await screen.findByRole('dialog', { name: 'Orders' });
    expect(drill()).toBe('2026-10-24');
    await waitFor(() => expect(calls('orders').at(-1)).toMatch(/period=custom.*from=2026-10-24.*to=2026-10-24.*page=1/));
    const lines = (await within(d).findAllByRole('row')).slice(1).map((r) => r.textContent);
    expect(lines).toEqual([
      '#1003Oct 24Shopify sitepaid$68.00$6.80$4.90$4.99–$61.20',
      '#1009Oct 24TikTok Shoppaid$68.00$6.80$4.90$4.99–Copy of tt-1, not counted',
      '#1001Oct 20 · refund onlyShopify sitepaid––––$20.00-$20.00',
    ]);
    expect(within(d).getByText(/they add up to \$405/)).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls('orders').at(-1)).toContain('page=2'));
    fireEvent.click(within(d).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(drill()).toBeNull());

    // a week's row opens that week's orders
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Rows by' })).getByRole('radio', { name: 'Week' }));
    await waitFor(() => expect(calls('sales').at(-1)).toContain('grain=week'));
    expect(where()).toContain('grain=week');
    fireEvent.click(within(await screen.findByRole('table', { name: 'Sales by week' })).getByRole('button', { name: 'Oct 24 – Oct 30' }));
    await screen.findByRole('dialog', { name: 'Orders' });
    expect(drill()).toBe('2026-10-24..2026-10-30');
    await waitFor(() => expect(calls('orders').at(-1)).toMatch(/from=2026-10-24.*to=2026-10-30/));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Orders' })).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(drill()).toBeNull());

    // the chart: Enter on the focused day
    const chart = screen.getByRole('img', { name: /^Net sales/ });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'Enter' });
    await waitFor(() => expect(drill()).toBe('2026-10-24'));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Orders' })).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(drill()).toBeNull());

    // the trend chart's table: a day is a button
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(within(screen.getByRole('table', { name: 'Net sales by day' })).getByRole('button', { name: /Oct 25$/ }));
    expect(await screen.findByRole('dialog', { name: 'Orders' })).toBeTruthy();
    expect(drill()).toBe('2026-10-25');
  });

  it('breakdowns: channels by name with the Unknown row, a product opens its drawer, a country it may not read says why', async () => {
    render('/analytics?store=a&tab=sales');
    const t = await screen.findByRole('table', { name: 'Net sales by channel' });
    expect(within(t).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Shopify site$37593%13', 'TikTok Shop$307%1', 'Unknown$1<1%0']);
    expect(screen.getByText(/Unknown: what the rows can't place/)).toBeTruthy();
    const by = screen.getByRole('radiogroup', { name: 'Break down by' });
    fireEvent.click(within(by).getByRole('radio', { name: 'Product' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Glow Serum' }));
    expect(where()).toContain('product=p1');
    expect(where()).toContain('by=product');
    fireEvent.click(within(by).getByRole('radio', { name: 'Country' }));
    expect((await screen.findByText(/^Shopify hasn't allowed/)).textContent).toBe("Needs permission: Shopify hasn't allowed reading the orders' shipping country (protected customer data)");
  });

  it("the Overview trend chart's day opens the Sales tab's orders for it", async () => {
    render('/analytics?store=a');
    const chart = await screen.findByRole('img', { name: /^Net sales/ });
    fireEvent.click(chart, { clientX: 0 });
    await waitFor(() => expect(where()).toContain('tab=sales'));
    expect(drill()).toBe('2026-10-24');
    expect(await screen.findByRole('dialog', { name: 'Orders' })).toBeTruthy();
  });

  it("the reconciliation: Dashboard's revenue to net sales line by line, each line's and dedupe's orders a click away, store-wide", async () => {
    const { calls } = render(`/analytics?store=a&tab=sales&filters=${encodeURIComponent('{"channels":["site"]}')}`);
    const t = await screen.findByRole('table', { name: 'Reconciliation' });
    expect(within(t).getAllByRole('row').map((r) => r.textContent)).toEqual([
      "Dashboard's revenue$470.37",
      'Tax in current totals2 orders-$31.97',
      "Amazon's daily totals (v1 counts its orders instead)2-$33.00",
      'Net sales· refund day$405.40',
    ]);
    const oids = () => new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]).get('oids');
    fireEvent.click(within(t).getByRole('button', { name: '2 orders' }));
    const d = await screen.findByRole('dialog', { name: 'Orders' });
    expect([drill(), oids()]).toEqual(['2026-10-24..2026-10-25', '#1003,#1004']);
    await waitFor(() => expect(calls('orders').at(-1)).toContain('ids=#1003,#1004'));
    expect(calls('orders').at(-1)).not.toContain('filters='); // like the reconciliation itself
    expect(calls('reconcile').at(-1)).not.toContain('filters=');
    expect(within(d).getByText(/1 named by the reconciliation/)).toBeTruthy();
    expect(within(d).getAllByRole('row')[1]!.textContent).toMatch(/^#1006.*Not counted$/);
    fireEvent.click(within(d).getByRole('button', { name: /close/i }));
    await waitFor(() => expect([drill(), oids()]).toEqual([null, null]));

    // dedupe: the copies left out without a match
    const copies = screen.getByText(/^TikTok Shop copies:/);
    expect(copies.textContent).toBe('TikTok Shop copies: 1 order matched, 1 order without a match');
    fireEvent.click(within(copies).getAllByRole('button')[1]!);
    await screen.findByRole('dialog', { name: 'Orders' });
    expect(oids()).toBe('#1010');
    expect(screen.getByText(/^Test, unpaid or voided orders/).textContent).toBe('Test, unpaid or voided orders, left out of both: 1 order · $45.00');
  });
});
