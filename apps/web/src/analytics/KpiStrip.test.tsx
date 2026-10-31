// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeOf, SA_METRICS, SA_OVERVIEW_KPIS, SA_REASONS, saDef, type SaMetricId, type SaMetricResult, type SaReason, type SaValue } from '@frontline/shared';
import { KpiStrip } from './KpiStrip';

const result = (id: SaMetricId, v: SaValue, prev: number | null = null): SaMetricResult => ({ ...v, id, def: saDef(id), previous: prev == null ? null : { value: prev, status: 'ok' }, change: changeOf(v.value, prev, SA_METRICS[id].unit) });
const BOARD: SaMetricResult[] = [
  result('net_sales', { value: 48920, status: 'ok' }, 43525),
  result('orders', { value: 1086, status: 'ok' }, 1005),
  result('aov', { value: 45.05, status: 'ok' }, 43.31),
  result('site_conversion', { value: 0.0179, status: 'ok' }, 0.0177),
  result('ad_spend', { value: 9840, status: 'ok' }, 8130),
  result('contribution_after_ads', { value: 11460, status: 'partial', coverage: { share: 0.92, of: 'units with a unit cost' } }, 11840),
];
const tile = (label: string) => screen.getByText(label, { selector: 'span' }).closest('div')!;
const strip = (p: Partial<Parameters<typeof KpiStrip>[0]> = {}) => render(<KpiStrip metrics={BOARD} tabs={['overview']} {...p} />, { wrapper: MemoryRouter });

afterEach(cleanup);

describe('KpiStrip (SA-70)', () => {
  it("the board's six tiles: value, change, previous and the definition or coverage line", () => {
    strip({ ctx: { channels: [{ kind: 'meta_ads', name: 'Meta Ads', status: 'connected' }, { kind: 'tiktok_ads', name: 'TikTok Ads', status: 'connected' }] } as never });
    expect(within(tile('Net sales')).getByText('$48,920')).toBeTruthy();
    expect(within(tile('Net sales')).getByText('▲ 12.4%').className).toContain('text-good');
    expect(within(tile('Net sales')).getByText('vs $43,525')).toBeTruthy();
    expect(within(tile('Net sales')).getByText(SA_METRICS.net_sales.line)).toBeTruthy();
    expect(within(tile('Avg. order value')).getByText('$45.05')).toBeTruthy();
    expect(within(tile('Avg. order value')).getByText('Order value ÷ orders, before refunds')).toBeTruthy(); // decision 11
    expect(within(tile('Site conversion')).getByText('1.79%')).toBeTruthy();
    expect(within(tile('Site conversion')).getByText('▲ 0.02 pts')).toBeTruthy();
    expect(within(tile('Ad spend')).getByText('▲ 21.0%').className).toContain('text-text-2'); // neither good nor bad
    expect(within(tile('Ad spend')).getByText('Meta Ads + TikTok Ads')).toBeTruthy();
    const c = tile('Contribution after ads');
    expect(within(c).getByText('▼ 3.2%').className).toContain('text-red');
    expect(within(c).getByText('92% of units with a unit cost').className).toContain('text-amber');
    expect(within(c).getByText('partial')).toBeTruthy();
  });

  it('no tile ever shows 0 for an unavailable value: each reason is said instead', () => {
    for (const reason of Object.keys(SA_REASONS) as SaReason[]) {
      const metrics = SA_OVERVIEW_KPIS.map((id) => result(id, { value: null, status: 'unavailable', reason }, 120));
      const { container } = strip({ metrics });
      expect(container.textContent).not.toMatch(/(^|[^\d.,])\$?0(\.0+)?%?([^\d.,]|$)/);
      expect(screen.getAllByText(SA_REASONS[reason])).toHaveLength(6);
      cleanup();
    }
  });

  it('"Breakdown →" appears only once its tab exists, keeping the rest of the URL', () => {
    strip();
    expect(screen.queryByText('Breakdown →')).toBeNull();
    cleanup();
    render(
      <MemoryRouter initialEntries={['/analytics?store=a&period=last7']}>
        <KpiStrip metrics={BOARD} tabs={['overview', 'sales']} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole('link', { name: 'Breakdown →' });
    expect(links).toHaveLength(3); // net sales, orders and AOV open Sales
    expect(links[0]!.getAttribute('href')).toBe('/analytics?store=a&period=last7&tab=sales');
  });

  it('with onSelect a tile picks the chart metric; without it no tile is a control', () => {
    strip();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    cleanup();
    const onSelect = vi.fn();
    strip({ onSelect, selected: 'net_sales' });
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(within(tile('Net sales')).getByRole('button').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Orders 1,086' })); // named by label and value
    expect(onSelect).toHaveBeenCalledWith('orders');
  });
});
