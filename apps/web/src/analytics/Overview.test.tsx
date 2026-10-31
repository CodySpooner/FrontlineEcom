// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, saDef, type SaInsights, type SaMoved } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';

const PERIOD = { preset: 'last30', from: '2026-09-30', to: '2026-10-29', days: 30, partial: false };
const COMPARE = { from: '2026-08-31', to: '2026-09-29', days: 30 };
const MOVED: SaMoved = {
  change: 275.4,
  rows: [
    { kind: 'product', id: '8002', title: 'Hydra Barrier Night Cream', image: null, change: 138, note: '38 left in stock' },
    { kind: 'product', id: 'tt-9001', title: 'Silk Sleep Scrunchie Set', image: null, change: 30, note: '10 left in stock', new: true },
    { kind: 'others', title: '2 other products', note: 'combined', change: 176.4 },
    { kind: 'product', id: '8003', title: 'Overnight Lip Mask', image: null, change: -69, note: 'Mint out of stock' },
  ],
  scope: { applied: [], ignored: [] },
};

function render(moved: () => unknown, insights: () => unknown = () => []) {
  const fetch = stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/overview'))
      return {
        period: PERIOD, compare: COMPARE, today: '2026-10-30', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: { applied: [], ignored: [] }, channels: [], annotations: 0,
        metrics: (['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'] as const).map((id) => ({ id, def: saDef(id), value: 10, status: 'ok', previous: { value: 9, status: 'ok' }, change: changeOf(10, 9, 'count') })),
      };
    if (url.startsWith('/api/analytics/contributions')) return moved();
    if (url.startsWith('/api/analytics/insights')) return insights();
    if (url.startsWith('/api/analytics/series') || url.startsWith('/api/analytics/summary')) return new Response('{}', { status: 500 });
    if (url.startsWith('/api/analytics/context')) return { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
    return [];
  });
  renderApp(<Analytics />, '/analytics?store=a');
  return fetch;
}
const panel = async () => (await screen.findByRole('heading', { name: 'What moved net sales' })).closest('section')!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('What moved (SA-73)', () => {
  it('rows with their notes, signed amounts and bars scaled to the largest move; Observed, not a cause', async () => {
    render(() => MOVED);
    const p = await panel();
    const rows = await within(p).findAllByRole('listitem');
    expect(p.textContent).toContain('+$275 vs previous period');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Hydra Barrier Night Cream38 left in stock+$138',
      'Silk Sleep Scrunchie SetNew · 10 left in stock+$30',
      '2 other productscombined+$176',
      'Overnight Lip MaskMint out of stock−$69',
    ]);
    const bar = (i: number) => (rows[i]!.querySelector('i') as HTMLElement).style;
    expect([bar(2).left, bar(2).width]).toEqual(['50%', '50%']); // the largest: half the track, right of the centre
    expect(bar(3).left).toBe(`${50 - (69 / 176.4) * 50}%`); // a fall: left of the centre
    expect(rows[3]!.querySelector('b:last-child')!.className).toContain('text-red');
    expect(within(p).getByText('Observed')).toBeTruthy();
    expect(within(p).getByText("Each product's share of the change, not its cause.")).toBeTruthy();
  });

  it('no comparison says why; a failed load retries', async () => {
    render(() => ({ change: null, note: 'No comparison period', rows: [], scope: { applied: [], ignored: [] } }));
    const p = await panel();
    expect(await within(p).findByText('No comparison period')).toBeTruthy();
    expect(within(p).queryByRole('list')).toBeNull();
    cleanup();
    let fail = true;
    render(() => (fail ? new Response('{}', { status: 502 }) : MOVED));
    const again = await panel();
    fail = false;
    fireEvent.click(await within(again).findByRole('button', { name: 'Try again' }));
    expect(await within(again).findByText('Hydra Barrier Night Cream')).toBeTruthy();
  });
});

const RULE = { when: 'w', minSample: 'm', datasets: [] };
const INSIGHTS: SaInsights = {
  insights: [
    { rule: 'stock_cover@1', kind: 'business', tone: 'warn', title: 'Hydra Barrier Night Cream: ~5 days of stock', detail: '38 left · 7.4 sold a day over the last 14 days', evidence: {}, target: { kind: 'product', id: '8002' } },
    { rule: 'late_fulfillment@1', kind: 'business', tone: 'red', title: '2 orders not shipped after 48 h', detail: 'Oldest #1001, placed Oct 26', evidence: {}, target: { kind: 'orders' } },
    { rule: 'listing_sync@1', kind: 'business', tone: 'info', title: '1 TikTok Shop listing failed to sync', detail: 'Silk Sleep Scrunchie Set · image under 600 px', evidence: {}, target: { kind: 'listings', channel: 'tiktok_shop' } },
    { rule: 'source_health@1', kind: 'data_health', tone: 'red', title: 'Meta Ads sync failing', detail: 'ad spend', evidence: {}, target: { kind: 'sources' } },
    { rule: 'ads_contribution@1', kind: 'business', tone: 'warn', title: 'Ad spend up 20.0% while contribution after ads fell 3.2%', detail: 'd', evidence: {}, target: { kind: 'metric', id: 'contribution_after_ads' } },
  ],
  rules: [
    { id: 'stock_cover@1', name: 'Low stock cover', when: 'Stock lasts under 10 days', minSample: '5 units sold in the last 14 days', datasets: ['orders', 'inventory'] },
    { id: 'source_health@1', name: 'Source health', ...RULE },
  ],
};

describe('Needs attention (SA-76)', () => {
  it('the count, the rows by tone, and each row opening its record; a listing row waits for Listings', async () => {
    const fetch = render(() => MOVED, () => INSIGHTS);
    const p = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')!;
    const rows = await within(p).findAllByRole('listitem');
    expect(p.textContent).toContain('5 flags');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Hydra Barrier Night Cream: ~5 days of stock38 left · 7.4 sold a day over the last 14 days',
      '2 orders not shipped after 48 hOldest #1001, placed Oct 26',
      '1 TikTok Shop listing failed to syncSilk Sleep Scrunchie Set · image under 600 px',
      'Meta Ads sync failingData health · ad spend',
      'Ad spend up 20.0% while contribution after ads fell 3.2%d',
    ]);
    expect(rows.map((r) => r.querySelector('i')!.className.match(/bg-\S+/)![0])).toEqual(['bg-amber', 'bg-red', 'bg-[#7fb2ff]', 'bg-red', 'bg-amber']);
    expect(within(rows[1]!).getByRole('link').getAttribute('href')).toBe('/orders');
    expect(within(rows[2]!).queryByRole('link')).toBeNull();
    expect(within(rows[2]!).queryByRole('button')).toBeNull(); // no Listings tab yet: no dead link

    fireEvent.click(within(rows[4]!).getByRole('button'));
    expect(await screen.findByRole('heading', { name: 'Contribution after ads' })).toBeTruthy(); // the chart shows it

    fireEvent.click(within(rows[3]!).getByRole('button'));
    expect(screen.getByTestId('where').textContent).toContain('panel=sources');
    expect(await screen.findByRole('dialog', { name: 'Data sources' })).toBeTruthy();

    fireEvent.click(within(rows[0]!).getByRole('button', { name: /Hydra Barrier/ }));
    expect(decodeURIComponent(screen.getByTestId('where').textContent!)).toContain('filters={"product":["8002"]}');
    const calls = () => fetch.mock.calls.map((c) => decodeURIComponent(String(c[0])));
    await within(p).findAllByRole('listitem');
    expect(calls().some((u) => u.startsWith('/api/analytics/overview') && u.includes('"product":["8002"]'))).toBe(true);
    expect(calls().filter((u) => u.startsWith('/api/analytics/insights')).every((u) => !u.includes('filters'))).toBe(true); // the rules read the whole store
  });

  it('How flags work lists every rule with its threshold, sample and datasets; nothing flagged says so; a failed load retries', async () => {
    render(() => MOVED, () => INSIGHTS);
    fireEvent.click(await screen.findByRole('button', { name: 'How flags work' }));
    const d = await screen.findByRole('dialog', { name: 'How flags work' });
    expect(within(d).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Low stock cover stock_cover@1Stock lasts under 10 daysMinimum sample: 5 units sold in the last 14 days · Reads: Orders, Inventory',
      "Source health source_health@1wMinimum sample: m · Reads: every source's sync status",
    ]);
    cleanup();
    render(() => MOVED, () => ({ ...INSIGHTS, insights: [] }));
    expect(await screen.findByText('No rule flagged anything in this period.')).toBeTruthy();
    cleanup();
    let fail = true;
    render(() => MOVED, () => (fail ? new Response('{}', { status: 502 }) : INSIGHTS));
    const p = (await screen.findByRole('heading', { name: 'Needs attention' })).closest('section')!;
    fail = false;
    fireEvent.click(await within(p).findByRole('button', { name: 'Try again' }));
    expect(await within(p).findByText('Meta Ads sync failing')).toBeTruthy();
  });
});
