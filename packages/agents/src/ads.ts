import type { DatabaseSync } from 'node:sqlite';

// Ad Strategist math (playbooks/ad_strategist.md "Decision rules"): judge each campaign against break-even ROAS.

export type Verdict = 'scale' | 'hold' | 'cut' | 'pause' | 'learning' | 'paused';

export interface CampaignStats {
  network: string;
  id: string;
  name: string;
  status: string;
  dailyBudget: number;
  spend: number;
  revenue: number;
  purchases: number;
}

export interface Economics {
  /** Margin after product cost, sales tax (core keeps it in daily cogs) and the owner's fee estimate, (revenue − cogs − fees) / revenue. */
  margin: number;
  aov: number;
}

export function thresholds({ margin, aov }: Economics) {
  const breakEven = margin > 0 ? 1 / margin : Infinity;
  return { breakEven, target: breakEven * 1.3, maxCpa: aov * margin };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Verdict + suggested daily budget per campaign. Needs spend ≥ 2× max CPA before judging. */
export function reviewCampaigns(campaigns: CampaignStats[], econ: Economics) {
  const { breakEven, target, maxCpa } = thresholds(econ);
  return campaigns.map((c) => {
    const roas = c.spend ? c.revenue / c.spend : 0;
    const verdict: Verdict =
      c.status !== 'active' ? 'paused'
      : c.spend < 2 * maxCpa ? 'learning'
      : roas >= target ? 'scale'
      : roas >= breakEven ? 'hold'
      : roas >= 0.7 * breakEven ? 'cut'
      : 'pause';
    const budget = verdict === 'scale' ? c.dailyBudget * 1.2 : verdict === 'cut' ? c.dailyBudget * 0.5 : verdict === 'pause' ? 0 : c.dailyBudget;
    return { ...c, roas: round(roas), cpa: c.purchases ? round(c.spend / c.purchases) : null, verdict, suggestedBudget: Math.round(budget) };
  });
}

/** 30-day margin and AOV for a store, from core's daily_metrics less the store's fee estimate (as core's profit does). */
export function economics(db: DatabaseSync, storeId: string, since: string): Economics {
  const r = db
    .prepare(
      `SELECT coalesce(sum(d.revenue), 0) AS revenue, coalesce(sum(d.cogs + d.revenue * s.fee_percent / 100 + d.orders * s.fee_per_order), 0) AS cogs,
         coalesce(sum(d.orders), 0) AS orders
       FROM daily_metrics d JOIN stores s ON s.id = d.store_id WHERE d.store_id = ? AND d.date >= ?`,
    )
    .get(storeId, since);
  const revenue = Number(r?.revenue ?? 0);
  return { margin: revenue ? (revenue - Number(r?.cogs ?? 0)) / revenue : 0, aov: Number(r?.orders) ? revenue / Number(r?.orders) : 0 };
}

/** Blended ROAS (store revenue ÷ ad spend) over [from, to], YYYY-MM-DD inclusive. */
export function blendedRoas(db: DatabaseSync, storeId: string, from: string, to: string) {
  // Amazon as an extra channel (core's channel_daily) is in the store's revenue, but the store's ads didn't make those sales.
  const r = db
    .prepare(
      `SELECT sum(revenue) - coalesce((SELECT sum(c.revenue) FROM channel_daily c JOIN stores s ON s.id = c.store_id
         WHERE c.store_id = ?1 AND c.channel = 'amazon' AND s.platform != 'amazon' AND c.date BETWEEN ?2 AND ?3), 0) AS revenue, sum(ad_spend) AS spend
       FROM daily_metrics WHERE store_id = ?1 AND date BETWEEN ?2 AND ?3`,
    )
    .get(storeId, from, to);
  return Number(r?.spend) ? Number(r?.revenue) / Number(r?.spend) : undefined;
}
