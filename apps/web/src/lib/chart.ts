// Pure helpers behind the hand-rolled SVG charts.
import type { AnalyticsRange } from '@frontline/shared';

export const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
  { value: 365, label: '1Y' },
];
export const PERIOD: Record<AnalyticsRange, string> = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', 365: 'last 12 months' };

/** Rounds an axis maximum up to a "nice" number: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^n. */
export function niceMax(v: number) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => n * p >= v) ?? 10) * p;
}

/** Sums daily points into 7-day buckets that end on the last day; a leading partial week is dropped. */
export function weekly(pts: { date: string; value: number }[]) {
  const out: { date: string; value: number }[] = [];
  for (let j = pts.length % 7; j < pts.length; j += 7) {
    const b = pts.slice(j, j + 7);
    out.push({ date: b[b.length - 1]!.date, value: b.reduce((a, p) => a + p.value, 0) });
  }
  return out;
}

/** Sparkline polyline points in a 100×30 box, downsampled to ~24 points. */
export function sparkPoints(vals: number[]) {
  const step = Math.max(1, Math.floor(vals.length / 24));
  const v = vals.filter((_, i) => i % step === 0);
  const lo = Math.min(...v);
  const span = Math.max(...v) - lo || 1;
  return v.map((y, i) => `${((i / Math.max(1, v.length - 1)) * 100).toFixed(1)},${(28 - ((y - lo) / span) * 24).toFixed(1)}`).join(' ');
}
