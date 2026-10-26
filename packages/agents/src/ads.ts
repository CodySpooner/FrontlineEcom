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
  /** Gross margin, (revenue − cogs) / revenue. */
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

/** 30-day gross margin and AOV for a store, from core's daily_metrics. */
export function economics(db: DatabaseSync, storeId: string, since: string): Economics {
  const r = db
    .prepare('SELECT coalesce(sum(revenue), 0) AS revenue, coalesce(sum(cogs), 0) AS cogs, coalesce(sum(orders), 0) AS orders FROM daily_metrics WHERE store_id = ? AND date >= ?')
    .get(storeId, since);
  const revenue = Number(r?.revenue ?? 0);
  return { margin: revenue ? (revenue - Number(r?.cogs ?? 0)) / revenue : 0, aov: Number(r?.orders) ? revenue / Number(r?.orders) : 0 };
}

/** Blended ROAS (store revenue ÷ ad spend) over [from, to], YYYY-MM-DD inclusive. */
export function blendedRoas(db: DatabaseSync, storeId: string, from: string, to: string) {
  const r = db.prepare('SELECT sum(revenue) AS revenue, sum(ad_spend) AS spend FROM daily_metrics WHERE store_id = ? AND date BETWEEN ? AND ?').get(storeId, from, to);
  return Number(r?.spend) ? Number(r?.revenue) / Number(r?.spend) : undefined;
}
