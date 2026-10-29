// Usage alerts (settings ST-15, decision 12): a store's AI spend or generation credits today reached the owner's share
// of its daily cap. Checked when a run ends and when credits are charged; once per store, cap and workspace-zone day.
import { costToday, creditsToday, workspaceZone } from '@frontline/agents';
import { settingsUrl } from '@frontline/shared';
import { localDate } from '../dates';
import { once, type Db } from '../db';
import { getCaps, getSettings, notify } from '../settings';

export function usageAlert(db: Db, storeId: string) {
  const s = getSettings(db).notifications;
  if (s.usageAlerts === false) return; // before once(): turned back on the same day, it still fires
  const pct = s.usageAlertPct ?? 80;
  const caps = getCaps(db, storeId);
  const store = String(db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId)?.name ?? storeId);
  const day = localDate(new Date(), workspaceZone(db));
  const checks = [
    { cap: 'agentCostPerDay', used: costToday(db, storeId), limit: caps.agentCostPerDay, what: "today's AI budget", of: (n: number) => `$${n.toFixed(2)}`, stop: 'its agents stop' },
    { cap: 'higgsfieldCreditsPerDay', used: creditsToday(db, storeId), limit: caps.higgsfieldCreditsPerDay, what: "today's generation credits", of: String, stop: 'new renders are refused' },
  ];
  for (const c of checks) {
    if (!(c.limit > 0) || c.used < (c.limit * pct) / 100 || !once(db, `usage-alert:${storeId}:${c.cap}:${day}`)) continue;
    notify(db, {
      kind: 'info',
      title: `${store}: ${Math.round((c.used / c.limit) * 100)}% of ${c.what} used`,
      body: `${c.of(c.used)} of the ${c.of(c.limit)} daily cap. At the cap ${c.stop} until tomorrow (workspace time), or until you raise it.`,
      storeId,
      link: settingsUrl('usage', { store: storeId }),
    }, { category: 'usageAlerts' });
  }
}
