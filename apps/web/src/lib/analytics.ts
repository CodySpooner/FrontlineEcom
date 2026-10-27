import type { AdNetwork, CampaignStats, MetricTotals } from '@frontline/shared';

/** ROAS at which ad spend eats the whole gross margin: revenue / (revenue − cogs). Below it, ads lose money. */
export function breakEvenRoas(t: MetricTotals) {
  // No sales: nothing to judge against (NaN, which roasTone leaves neutral), not "every campaign loses money".
  if (!t.revenue) return NaN;
  const gross = t.profit + t.adSpend;
  return gross > 0 ? t.revenue / gross : Infinity;
}

/** bad = below break-even, good = at least 1.5× break-even. */
export const roasTone = (roas: number, breakEven: number) => (roas < breakEven ? 'bad' : roas >= 1.5 * breakEven ? 'good' : 'ok');

/** ROAS as "2.61×"; a dash when the ad spend behind it is 0, where the ratio means nothing. */
export const times = (roas: number, spend?: number) => (spend === 0 ? '–' : `${roas.toFixed(2)}×`);

/** Percent of `b` that `a` is (0 when b is 0). */
export const rate = (a: number, b: number) => (b ? (100 * a) / b : 0);

export type Channel = { network: AdNetwork; spend: number; revenue: number; purchases: number; roas: number };

/** Campaigns rolled up per ad network, biggest revenue first. */
export function byNetwork(cs: CampaignStats[]): Channel[] {
  const m = new Map<AdNetwork, Channel>();
  for (const c of cs) {
    const ch = m.get(c.network) ?? { network: c.network, spend: 0, revenue: 0, purchases: 0, roas: 0 };
    ch.spend += c.spend;
    ch.revenue += c.revenue;
    ch.purchases += c.purchases;
    m.set(c.network, ch);
  }
  return [...m.values()].map((ch) => ({ ...ch, roas: ch.spend ? ch.revenue / ch.spend : 0 })).sort((a, b) => b.revenue - a.revenue);
}
