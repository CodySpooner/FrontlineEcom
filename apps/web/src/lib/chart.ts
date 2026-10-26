// Pure helpers behind the hand-rolled SVG charts.
import type { AnalyticsRange } from '@frontline/shared';

export const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
  { value: 365, label: '1Y' },
];
export const PERIOD: Record<AnalyticsRange, string> = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 90 days', 365: 'last 12 months' };

/** Axis ticks from 0 to just past `v`: 3–5 equal steps of 1, 2 or 5 × 10^n, so every label is exact ($1K, $2K, $3K). */
export function niceTicks(v: number) {
  if (!(v > 0)) return [0, 1];
  for (let p = 10 ** Math.floor(Math.log10(v / 5)); ; p *= 10) {
    for (const m of [1, 2, 5]) {
      const k = Math.ceil(v / (m * p));
      if (k <= 5) return Array.from({ length: k + 1 }, (_, i) => +(i * m * p).toPrecision(12));
    }
  }
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
