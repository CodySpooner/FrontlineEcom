// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarChart, barSummary } from './BarChart';

afterEach(cleanup);

const p = (from: string, value: number | null, to = from) => ({ from, to, value, status: value == null ? ('unavailable' as const) : ('ok' as const), previous: null });

describe('BarChart (SA-89)', () => {
  it('a reported 0 is a hairline, a day not reported has no bar', () => {
    const { container } = render(<BarChart points={[p('2026-10-01', 0), p('2026-10-02', null), p('2026-10-03', 5)]} grain="day" label="Units sold per day" table={false} />);
    const bars = [...container.querySelectorAll('rect')].map((r) => [r.getAttribute('data-day'), Number(r.getAttribute('height')) > 1]);
    expect(bars).toEqual([['2026-10-01', false], ['2026-10-03', true]]);
    expect(container.querySelector('rect')!.getAttribute('height')).toBe('1');
  });

  it('the summary by week, and with nothing reported', () => {
    expect(barSummary([p('2026-01-05', 3, '2026-01-11'), p('2026-01-12', 9, '2026-01-18')], 'week', 'Units sold per week')).toBe('Units sold per week, Jan 5 – Jan 18: 12 in all. Most on Jan 12 – Jan 18, 9.');
    expect(barSummary([p('2026-01-05', null), p('2026-01-06', null)], 'day', 'Units sold per day')).toBe('Units sold per day, Jan 5 – Jan 6: none reported. 2 days not reported.');
  });
});
