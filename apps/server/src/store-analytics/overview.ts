// SA-69: the Overview in one call (spec §6 Overview priorities): the six KPIs through computeMetricSet, the same set
// /metrics gives for the scope, each sales channel's net sales and orders, and the annotation and attention counts.
import { SA_OVERVIEW_KPIS, type SaFilters, type SaOverview } from '@frontline/shared';
import type { Db } from '../db';
import { annotations } from './annotations';
import { insights } from './insights';
import { computeMetricSet } from './metric-set';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, type RefundBasis } from './sales';

/** The channels the period's orders came through, as the channel filter names them (sliceSql's rule). */
export function channelsIn(db: Db, storeId: string, from: string, to: string, filters: SaFilters) {
  const platform = String(db.prepare('SELECT platform FROM stores WHERE id = ?').get(storeId)!.platform);
  const own = platform === 'shopify' || platform === 'woocommerce' ? 'site' : platform;
  return db
    .prepare(`SELECT DISTINCT coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) AS ch FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`)
    .all(own, storeId, from, to)
    .map((r) => String(r.ch))
    .filter((c) => !filters.channel?.length || filters.channel.includes(c));
}

export function overview(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaOverview {
  const set = { ...computeMetricSet(db, scope, SA_OVERVIEW_KPIS, sp, filters, basis), annotations: annotations(db, scope.storeId, sp).length, attention: insights(db, scope.storeId, sp).insights.length };
  if (db.prepare('SELECT demo FROM stores WHERE id = ?').get(scope.storeId)!.demo) return { ...set, channels: [], channelsNote: "Demo data isn't split by channel" };
  const channels = channelsIn(db, scope.storeId, sp.period.from, sp.period.to, filters).map((channel) => {
    const [net, orders] = computeMetricSet(db, scope, ['net_sales', 'orders'], { ...sp, compare: undefined }, { ...filters, channel: [channel] }, basis).metrics;
    return { channel, net_sales: net!, orders: orders! };
  });
  return { ...set, channels: channels.sort((a, b) => (b.net_sales.value ?? 0) - (a.net_sales.value ?? 0) || a.channel.localeCompare(b.channel)) };
}
