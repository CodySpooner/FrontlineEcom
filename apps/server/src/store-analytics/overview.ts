// SA-69: the Overview in one call (spec §6 Overview priorities): the six KPIs through computeMetricSet, the same set
// /metrics gives for the scope, and each sales channel's net sales and orders. ponytail: the annotation and attention
// counts join this response when their engines exist (SA-72, SA-74).
import { SA_OVERVIEW_KPIS, type SaFilters, type SaOverview } from '@frontline/shared';
import type { Db } from '../db';
import { computeMetricSet } from './metric-set';
import type { StorePeriod } from './period';
import type { Scope } from './routes';
import { CANONICAL, type RefundBasis } from './sales';

export function overview(db: Db, scope: Scope, sp: StorePeriod, filters: SaFilters = {}, basis: RefundBasis = 'refund_day'): SaOverview {
  const set = computeMetricSet(db, scope, SA_OVERVIEW_KPIS, sp, filters, basis);
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(scope.storeId)!;
  if (store.demo) return { ...set, channels: [], channelsNote: "Demo data isn't split by channel" };
  // The channels the period's orders came through, as the channel filter names them (sliceSql's rule).
  const own = store.platform === 'shopify' || store.platform === 'woocommerce' ? 'site' : String(store.platform);
  const seen = db
    .prepare(`SELECT DISTINCT coalesce(o.channel, iif(+o.id GLOB 'tt-*', 'tiktok_shop', ?)) AS ch FROM orders o WHERE o.store_id = ? AND o.local_date BETWEEN ? AND ? AND ${CANONICAL}`)
    .all(own, scope.storeId, sp.period.from, sp.period.to)
    .map((r) => String(r.ch))
    .filter((c) => !filters.channel?.length || filters.channel.includes(c));
  const channels = seen.map((channel) => {
    const [net, orders] = computeMetricSet(db, scope, ['net_sales', 'orders'], { ...sp, compare: undefined }, { ...filters, channel: [channel] }, basis).metrics;
    return { channel, net_sales: net!, orders: orders! };
  });
  return { ...set, channels: channels.sort((a, b) => (b.net_sales.value ?? 0) - (a.net_sales.value ?? 0) || a.channel.localeCompare(b.channel)) };
}
