import type { PrDemandClass, PrGranularity } from '@frontline/shared';

export interface DemandPoint {
  at: string; // YYYY-MM-DD, or YYYY-MM for a monthly set
  value: number;
}
export interface Demand {
  cls: PrDemandClass;
  /** 1–12: a seasonal set's peak month. */
  peakMonth: number | null;
  /** Mean of the last window over the window before ("growth ratio, not interest level"); null when not meaningful. */
  momentum: number | null;
}

// Decision 9's thresholds. Change one only with a backlog Notes line.
const MIN_POINTS: Record<PrGranularity, number> = { day: 90, week: 26, month: 24 };
const WINDOW: Record<PrGranularity, number> = { day: 90, week: 13, month: 3 }; // 13 weeks ≈ 90 days ≈ 3 months
const YEAR: Record<PrGranularity, number> = { day: 0, week: 52, month: 12 }; // a daily export never spans two years

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const cv = (v: number[]) => {
  const m = mean(v);
  return m === 0 ? Infinity : Math.sqrt(mean(v.map((x) => (x - m) ** 2))) / m;
};
const month = (at: string) => Number(at.slice(5, 7));

/** The month in the top 10% of each of the last two years, peak at least 2× trough; else null. */
function seasonalPeak(points: DemandPoint[], g: PrGranularity): number | null {
  const n = YEAR[g];
  if (!n || points.length < 2 * n) return null;
  const years = [points.slice(-2 * n, -n), points.slice(-n)];
  // Only points above the year's median can be its top 10%: on a flat baseline, ties would pick months at random.
  const top = years.map((y) => {
    const med = median(y.map((p) => p.value));
    return y.filter((p) => p.value > med).sort((a, b) => b.value - a.value).slice(0, Math.ceil(y.length / 10));
  });
  const before = new Set(top[0]!.map((p) => month(p.at)));
  const peak = top[1]!.find((p) => before.has(month(p.at))); // the latest year's highest point in a shared month
  const values = years.flat().map((p) => p.value);
  return peak && Math.max(...values) >= 2 * Math.min(...values) ? month(peak.at) : null;
}

/**
 * Decision 9: one set's demand class, in precedence order. Values are one export's relative interest, so nothing here
 * compares across sets. "<1" is stored as 0, and a 0 counts as below 1 too (Google shows low-volume terms as 0).
 */
export function classifyDemand(points: DemandPoint[], g: PrGranularity): Demand {
  const v = points.map((p) => p.value);
  const w = WINDOW[g];
  if (v.length < MIN_POINTS[g] || v.filter((x) => x < 1).length * 2 > v.length) return { cls: 'insufficient_history', peakMonth: null, momentum: null };
  const last = mean(v.slice(-w));
  const prior = v.length >= 2 * w ? mean(v.slice(-2 * w, -w)) : null;
  const momentum = prior ? Math.round((last / prior) * 100) / 100 : null;
  const out = (cls: PrDemandClass, peakMonth: number | null = null): Demand => ({ cls, peakMonth, momentum });
  const peak = seasonalPeak(points, g);
  if (peak) return out('seasonal', peak);
  const med = median(v);
  if (Math.max(...v) >= 3 * med && v.filter((x) => x > 2 * med).length < 3) return out('isolated_spike');
  if (prior !== null && prior >= 5 && last >= 1.3 * prior) return out('recent_acceleration');
  if (med >= 20 && cv(v) <= 0.5) return out('sustained');
  return out('no_clear_pattern');
}
