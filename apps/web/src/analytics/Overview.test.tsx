// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, saDef, type SaMoved } from '@frontline/shared';
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

function render(moved: () => unknown) {
  stubApi((url) => {
    if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
    if (url.startsWith('/api/analytics/overview'))
      return {
        period: PERIOD, compare: COMPARE, today: '2026-10-30', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: { applied: [], ignored: [] }, channels: [], annotations: 0,
        metrics: (['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'] as const).map((id) => ({ id, def: saDef(id), value: 10, status: 'ok', previous: { value: 9, status: 'ok' }, change: changeOf(10, 9, 'count') })),
      };
    if (url.startsWith('/api/analytics/contributions')) return moved();
    if (url.startsWith('/api/analytics/series') || url.startsWith('/api/analytics/summary')) return new Response('{}', { status: 500 });
    if (url.startsWith('/api/analytics/context')) return { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
    return [];
  });
  renderApp(<Analytics />, '/analytics?store=a');
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
