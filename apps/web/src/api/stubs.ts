// Temporary stand-ins for UI-11 until core ships the endpoints requested in docs/backlog/core.md ("(from ui) For UI-11").
// The interfaces are the proposed contracts. Each stub derives from real data so its numbers agree with the KPIs.
// Delete a stub (and its type, once it's in @frontline/shared) when its endpoint lands.
import type { AnalyticsSummary, Product } from '@frontline/shared';

export type AdNetwork = 'meta' | 'tiktok' | 'google';
export interface CampaignStats {
  network: AdNetwork;
  id: string;
  storeId: string;
  name: string;
  status: 'active' | 'paused';
  dailyBudget: number;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  clicks: number;
  impressions: number;
}
export interface Funnel {
  sessions: number;
  addToCarts: number;
  checkouts: number;
  orders: number;
}
export interface TopProduct {
  storeId: string;
  productId: string;
  title: string;
  image?: string;
  units: number;
  revenue: number;
  profit: number;
}

/** Stable 0..1 per key (FNV-1a), so stub numbers don't jump between renders. */
export const unit = (key: string) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
};

const CAMPAIGNS: [AdNetwork, string, number][] = [
  ['meta', 'Prospecting · Broad', 0.45],
  ['tiktok', 'Spark Ads · UGC', 0.3],
  ['meta', 'Retargeting · 7-day', 0.15],
  ['google', 'Shopping · Brand', 0.1],
];

/** Splits each store's real ad spend across four campaigns; revenue, clicks and purchases follow a per-campaign ROAS, CPC and AOV. */
export function stubCampaigns(s: AnalyticsSummary): CampaignStats[] {
  const days = Math.max(1, s.series.length);
  return s.byStore
    .flatMap(({ storeId, totals }) =>
      CAMPAIGNS.map(([network, name, share], i): CampaignStats => {
        const r = unit(`${storeId}:${i}`);
        const spend = Math.round(totals.adSpend * share);
        const roas = Math.round((0.7 + 3.6 * r) * 100) / 100;
        const revenue = Math.round(spend * roas);
        const clicks = Math.round(spend / (0.5 + r));
        return {
          network,
          id: `${storeId}-${i}`,
          storeId,
          name,
          status: r < 0.12 ? 'paused' : 'active',
          dailyBudget: Math.round(spend / days),
          spend,
          revenue,
          roas,
          purchases: Math.round(revenue / (totals.aov || 40)),
          clicks,
          impressions: Math.round(clicks / (0.008 + 0.02 * unit(name + storeId))),
        };
      }),
    )
    .sort((a, b) => b.spend - a.spend);
}

/** Real orders; sessions, carts and checkouts back out of typical store rates (CR 2–3.5%, cart→checkout 50%, checkout→order 60%). */
export function stubFunnel(s: AnalyticsSummary): Funnel {
  const { orders } = s.totals;
  const checkouts = Math.round(orders / 0.6);
  return { sessions: Math.round(orders / (0.02 + 0.015 * unit(s.storeIds.join()))), addToCarts: Math.round(checkouts / 0.5), checkouts, orders };
}

/** Real active products with stub sales: units scale with the period length. */
export function stubTopProducts(products: Product[], days: number, limit = 8): TopProduct[] {
  return products
    .filter((p) => p.status === 'active')
    .map((p) => {
      const units = Math.round(days * (0.3 + 2.5 * unit(p.storeId + p.id)));
      return { storeId: p.storeId, productId: p.id, title: p.title, ...(p.image && { image: p.image }), units, revenue: units * p.price, profit: units * (p.price - p.cost) };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
