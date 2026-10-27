// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AreaChart } from './AreaChart';

// jsdom has no ResizeObserver; the chart only uses it to track its width.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AreaChart', () => {
  it('draws a losing day below $0, on an axis that reaches it', () => {
    const points = [
      { date: '2026-10-01', value: 100 },
      { date: '2026-10-02', value: -50 },
      { date: '2026-10-03', value: 80 },
    ];
    const { container } = render(<AreaChart points={points} label="Profit" />);
    expect(screen.getByText('−$50')).toBeTruthy();
    const zero = screen.getByText('$0').previousElementSibling!.getAttribute('y1');
    fireEvent.keyDown(screen.getByRole('img'), { key: 'ArrowRight' });
    const dot = container.querySelector('circle')!.getAttribute('cy');
    expect(Number(dot)).toBeGreaterThan(Number(zero));
  });

  it("doesn't shade today's unfinished day, only dashes its line", () => {
    const points = [
      { date: '2026-10-01', value: 100 },
      { date: '2026-10-02', value: 120 },
      { date: '2026-10-03', value: 30 },
    ];
    const { container } = render(<AreaChart points={points} partial label="Revenue" />);
    const [a, b] = [...container.querySelectorAll('polyline')].map((l) => l.getAttribute('points')!.split(' '));
    const fill = container.querySelector('polygon')!.getAttribute('points')!.split(' ');
    expect(fill.slice(1, -1)).toEqual(a);
    expect(fill.at(-1)!.split(',')[0]).toBe(b![0]!.split(',')[0]);
  });
});
