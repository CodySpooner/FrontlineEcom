// SA-20: ad spend, platform ROAS and contribution after ads (SA_METRICS) for one store's days.
import { SA_SOURCES, combineStatus, ratio, settingsUrl, type SaValue } from '@frontline/shared';
import type { Db } from '../db';
import { costMetrics } from './costs';
import { demoDays, type Slice } from './sales';

export type AdMetricId = 'ad_spend' | 'platform_roas' | 'contribution_after_ads';
/** One network's period: spend in the store's currency and its own attributed ROAS (null with no spend). */
export type NetworkSpend = { network: string; name: string; spend: number; roas: number | null; attribution: string };

/** campaigns.network → its integration kind. */
const KINDS = { meta: 'meta_ads', google: 'google_ads', tiktok: 'tiktok_ads' } as const;
const NAME = (network: string) => (network in KINDS ? SA_SOURCES[KINDS[network as keyof typeof KINDS]].name : network);
/** SA-58: the setting the network's last read recorded (noteAdReads), else that it isn't recorded. */
const attribution = (db: Db, storeId: string, network: string) => {
  const note = network in KINDS ? db.prepare("SELECT error FROM source_datasets WHERE integration_id = ? AND dataset = 'attribution' AND status = 'available'").get(`${KINDS[network as keyof typeof KINDS]}:${storeId}`)?.error : null;
  return `${NAME(network).replace(/ Ads$/, '')}'s own attribution · ${note ?? 'attribution setting not recorded'}`;
};

const cents = (n: number) => Math.round(n * 100) / 100;
const value = (v: number | null, status: SaValue['status'], extra: Omit<SaValue, 'value' | 'status'> = {}): SaValue => ({ value: v, status, ...extra });

/**
 * Spend comes from campaign_daily rows of the store's campaigns, already in the store's currency (the connectors convert
 * at sync, each day at its ECB rate; the account's currency is in its ad_spend note, SA-58). A network counts once it
 * synced; a store with no ad integration has no spend to show, not $0.
 * Spend is store level, so a slice's channels don't apply; its cut scales the last day (day grain, estimated).
 */
export function adMetrics(
  db: Db,
  storeId: string,
  from: string,
  to: string,
  { before, slice }: { before?: SaValue; slice?: Slice } = {},
): { values: Record<AdMetricId, SaValue>; networks: NetworkSpend[] } {
  before ??= costMetrics(db, storeId, from, to, 'refund_day', slice).contribution_before_ads;
  const demo = !!db.prepare('SELECT demo FROM stores WHERE id = ?').get(storeId)?.demo;
  const k = slice?.cut?.fraction ?? 1;
  const networks: NetworkSpend[] = db
    .prepare(
      `SELECT d.network, sum(d.spend * iif(d.date = ?, ?, 1)) AS spend, sum(d.revenue * iif(d.date = ?, ?, 1)) AS revenue FROM campaign_daily d
       JOIN campaigns c ON c.network = d.network AND c.id = d.campaign_id WHERE c.store_id = ? AND d.date BETWEEN ? AND ? GROUP BY d.network ORDER BY d.network`,
    )
    .all(to, k, to, k, storeId, from, to)
    .map((r) => ({ network: String(r.network), name: NAME(String(r.network)), spend: cents(Number(r.spend)), roas: ratio(Number(r.revenue), Number(r.spend)), attribution: attribution(db, storeId, String(r.network)) }));

  let spend: SaValue;
  if (demo) {
    // Dashboard's demo spend (daily_metrics), so the two never disagree.
    const days = demoDays(db, storeId, from, to, slice?.cut);
    spend = days.length ? value(cents(days.reduce((a, d) => a + d.adSpend, 0)), 'demo') : value(null, 'unavailable', { reason: 'insufficient_history', note: 'Before the demo history' });
  } else {
    const accounts = db.prepare("SELECT kind, synced_at FROM integrations WHERE store_id = ? AND kind IN ('meta_ads', 'google_ads', 'tiktok_ads') ORDER BY kind").all(storeId);
    const unsynced = accounts.filter((a) => a.synced_at == null).map((a) => SA_SOURCES[a.kind as keyof typeof SA_SOURCES].name);
    const total = cents(networks.reduce((a, n) => a + n.spend, 0));
    spend = !accounts.length
      ? value(null, 'unavailable', { reason: 'needs_credentials', note: 'No ad network connected', fix: { label: 'Connect an ad network', href: settingsUrl('integrations', { store: storeId }) } })
      : unsynced.length === accounts.length
        ? value(null, 'unavailable', { reason: 'needs_ingestion', note: `Not synced yet: ${unsynced.join(', ')}` })
        : value(total, combineStatus(unsynced.length ? 'partial' : 'ok', slice?.cut ? 'estimated' : 'ok'), unsynced.length ? { note: `Not synced yet: ${unsynced.join(', ')}` } : {});
  }

  // Never combined across networks (their attributed sales overlap): one network gives its own figure, several a note.
  const spent = networks.filter((n) => n.roas != null);
  const roas =
    spend.value == null
      ? spend
      : spent.length === 1
        ? value(spent[0]!.roas, demo ? 'demo' : spend.status, { note: spent[0]!.attribution })
        : spent.length
          ? value(null, 'unavailable', { note: `Per network, never combined: ${spent.map((n) => `${n.name} ${n.roas!.toFixed(2)}×`).join(', ')}` })
          : value(null, 'unavailable', { note: 'No ad spend in this period' });

  // Store level only: ad spend is never allocated (decision 16).
  const after =
    before.value == null ? before : spend.value == null ? spend : value(cents(before.value - spend.value), demo ? 'demo' : combineStatus(before.status, spend.status), before.coverage ? { coverage: before.coverage } : {});
  return { values: { ad_spend: spend, platform_roas: roas, contribution_after_ads: after }, networks };
}
