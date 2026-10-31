// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, saDef, type SaMetricResult, type SaSeries } from '@frontline/shared';
import { Analytics } from '../pages/Analytics';
import { renderApp, stubApi } from '../test-utils';
import { summary, TrendChart } from './TrendChart';

const total: SaMetricResult = { id: 'net_sales', def: saDef('net_sales'), value: 600, status: 'ok', previous: { value: 500, status: 'ok' }, change: changeOf(600, 500, 'money') };
const SERIES: SaSeries = {
  metric: 'net_sales',
  def: saDef('net_sales'),
  grain: 'day',
  period: { preset: 'custom', from: '2026-10-12', to: '2026-10-16', days: 5, partial: false },
  compare: { from: '2026-10-07', to: '2026-10-11', days: 5 },
  points: [
    { from: '2026-10-12', to: '2026-10-12', value: 100, status: 'ok', previous: 90 },
    { from: '2026-10-13', to: '2026-10-13', value: 250, status: 'ok', previous: 110 },
    { from: '2026-10-14', to: '2026-10-14', value: null, status: 'unavailable', previous: 100 },
    { from: '2026-10-15', to: '2026-10-15', value: 0, status: 'ok', previous: null },
    { from: '2026-10-16', to: '2026-10-16', value: 250, status: 'ok', previous: 200 },
  ],
  total,
  scope: { applied: [], ignored: [] },
};

afterEach(cleanup);

describe('TrendChart (SA-71)', () => {
  it('the table has the same numbers as the series; a null day reads "Not reported", a real 0 reads $0', () => {
    render(<TrendChart series={SERIES} label="Net sales" table />);
    const rows = within(screen.getByRole('table', { name: 'Net sales by day' })).getAllByRole('row').slice(1);
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['Mon Oct 12', '$100', '$90 (Oct 7)'],
      ['Tue Oct 13', '$250', '$110 (Oct 8)'],
      ['Wed Oct 14', 'Not reported', '$100 (Oct 9)'],
      ['Thu Oct 15', '$0', '– (Oct 10)'],
      ['Fri Oct 16', '$250', '$200 (Oct 11)'],
    ]);
  });

  it('a null day is a gap in the line, never drawn at 0; the summary says so', () => {
    const { container } = render(<TrendChart series={SERIES} label="Net sales" table={false} />);
    const period = [...container.querySelectorAll('path[data-series="period"]')].map((p) => p.getAttribute('d')!);
    expect(period).toHaveLength(2); // Oct 12–13, then Oct 15–16
    expect(period.map((d) => d.match(/[ML]/g)!.length)).toEqual([2, 2]);
    expect(container.querySelectorAll('path[data-series="previous"]')).toHaveLength(2); // Oct 15 had no previous day
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(summary(SERIES, 'Net sales'));
    expect(summary(SERIES, 'Net sales')).toBe('Net sales by day, Oct 12 – Oct 16: $600, up 20.0% vs Oct 7 – Oct 11. Highest Tue Oct 13, $250. 1 day not reported.');
  });

  it('hovering a day shows both dates; the keyboard moves through them', () => {
    render(<TrendChart series={SERIES} label="Net sales" table={false} />);
    const img = screen.getByRole('img');
    fireEvent.keyDown(img, { key: 'Home' });
    expect(screen.getByText(/Mon Oct 12 · \$100/)).toBeTruthy();
    expect(screen.getByText('Previous: $90 (Oct 7)')).toBeTruthy();
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    fireEvent.keyDown(img, { key: 'ArrowRight' });
    expect(screen.getByText(/Wed Oct 14 · Not reported/)).toBeTruthy();
  });

  it('today in the period is dashed and labelled so far', () => {
    const today = { ...SERIES, period: { ...SERIES.period, partial: true }, points: SERIES.points.map((p, i) => (i === 4 ? { ...p, partial: true as const } : p)) };
    const { container } = render(<TrendChart series={today} label="Net sales" table={false} />);
    expect(container.querySelector('path[data-series="partial"]')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('img'), { key: 'End' });
    expect(screen.getByText('so far')).toBeTruthy();
  });
});

describe('Overview trend panel', () => {
  it('a KPI tile picks the chart; Contribution is after ads with ad data, else before, labelled; Table toggles', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const asked: string[] = [];
    const set = (adSpend: number | null) => ({
      period: SERIES.period, compare: SERIES.compare, today: '2026-10-17', zoneLabel: 'Eastern Time', zoneAbbr: 'ET', scope: { applied: [], ignored: [] }, channels: [], channelsNote: "Demo data isn't split by channel",
      metrics: (['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'] as const).map((id) => ({ ...total, id, def: saDef(id), value: id === 'ad_spend' ? adSpend : 10 })),
    });
    let ads: number | null = null;
    stubApi((url) => {
      if (url === '/api/stores') return [{ id: 'a', name: 'Glow Haus' }];
      if (url.startsWith('/api/analytics/overview')) return set(ads);
      if (url.startsWith('/api/analytics/series')) {
        const metric = new URLSearchParams(url.split('?')[1]).get('metric')!;
        asked.push(metric);
        return { ...SERIES, metric, def: saDef(metric as 'orders') };
      }
      if (url.startsWith('/api/analytics/summary')) return new Response('{}', { status: 500 });
      if (url.startsWith('/api/analytics/context')) return { storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: null, zoneLabel: '', zoneAbbr: 'ET', historyStart: null, freshness: [] };
      return [];
    });
    renderApp(<Analytics />, '/analytics?store=a');
    const panel = (await screen.findByText('Daily · today (partial) not included · Eastern Time')).closest('section')!;
    expect(within(panel).getByRole('heading', { name: 'Net sales' })).toBeTruthy();
    expect(within(panel).getByText("Demo data isn't split by channel")).toBeTruthy(); // no split: says why, no swatches
    fireEvent.click(within(screen.getByRole('region', { name: 'Key numbers' })).getByRole('button', { name: /Orders/ }));
    await waitFor(() => expect(within(panel).getByRole('heading', { name: 'Orders' })).toBeTruthy());
    expect(within(panel).getByRole('radio', { name: 'Orders' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Contribution' }));
    await waitFor(() => expect(asked.at(-1)).toBe('contribution_before_ads')); // no ad spend: before ads
    expect(within(panel).getByRole('heading', { name: 'Contribution before ads' })).toBeTruthy();
    expect(within(panel).queryByText("Demo data isn't split by channel")).toBeNull(); // the split is sales and orders only
    fireEvent.click(within(panel).getByRole('button', { name: 'Table' }));
    expect(await within(panel).findByRole('table')).toBeTruthy();
    cleanup();
    ads = 900;
    renderApp(<Analytics />, '/analytics?store=a');
    const again = (await screen.findByText('Daily · today (partial) not included · Eastern Time')).closest('section')!;
    fireEvent.click(within(again).getByRole('radio', { name: 'Contribution' }));
    await waitFor(() => expect(asked.at(-1)).toBe('contribution_after_ads'));
    vi.unstubAllGlobals();
  });
});
