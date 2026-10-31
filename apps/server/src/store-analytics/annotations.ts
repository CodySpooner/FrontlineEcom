// SA-72 (decision 45): the chart's read-only markers for one store and period, from real records only. The owner's own
// notes join in SA-133. Context, never a cause: the UI says so over the list.
import { SA_SOURCES, type SaAnnotation, type SaSourceKind } from '@frontline/shared';
import type { Db } from '../db';
import { localDate } from '../dates';
import type { StorePeriod } from './period';

/** A source failing for longer than this is a data-health marker. */
export const GAP_HOURS = 3;
/** Approved requests that change the store or its ads (a price change is its `price_tests` row instead). */
const CHANGE_KINDS = ['ads.set_budget', 'ads.pause_campaign', 'store.add_products', 'store.publish_page', 'store.publish_theme', 'store.set_price'];

const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const hours = (ms: number) => {
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

export function annotations(db: Db, storeId: string, sp: StorePeriod, now = Date.now()): SaAnnotation[] {
  const { from, to } = sp.period;
  const zone = sp.zone;
  const currency = String(db.prepare('SELECT currency FROM stores WHERE id = ?').get(storeId)!.currency);
  const price = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, ...(Number.isInteger(v) && { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }).format(v);
  const out: SaAnnotation[] = [];

  const tests = db.prepare('SELECT approval_id, title, from_price, to_price, changed_on FROM price_tests WHERE store_id = ? AND changed_on BETWEEN ? AND ?').all(storeId, from, to);
  for (const t of tests) out.push({ kind: 'price_test', date: String(t.changed_on), text: `Price ${price(Number(t.from_price))} → ${price(Number(t.to_price))} on ${t.title}` });

  // ponytail: approved, not proof it was carried out; the wording says "Approved". Few rows a store, filtered by day here.
  const approved = db
    .prepare(
      `SELECT title, decided_at FROM approvals WHERE store_id = ? AND status = 'approved' AND decided_at IS NOT NULL
       AND action_json ->> '$.kind' IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT approval_id FROM price_tests WHERE store_id = ?)`,
    )
    .all(storeId, JSON.stringify(CHANGE_KINDS), storeId);
  for (const a of approved) {
    const date = localDate(new Date(String(a.decided_at)), zone);
    if (date >= from && date <= to) out.push({ kind: 'app_change', date, text: `Approved: ${a.title}` });
  }

  // A failure window runs from a source's first failed sync to its next successful one (or now, still failing).
  const runs = db
    .prepare("SELECT integration_id, kind, status, started_at, coalesce(finished_at, started_at) AS ended FROM sync_runs WHERE store_id = ? AND status IN ('done', 'failed') ORDER BY integration_id, started_at, id")
    .all(storeId);
  const gap = (kind: string, start: number, end: number, recovered: boolean) => {
    if (end - start <= GAP_HOURS * 3_600_000) return;
    const [a, b] = [localDate(new Date(start), zone), localDate(new Date(end), zone)];
    if (a > to || b < from) return;
    const name = SA_SOURCES[kind as SaSourceKind]?.name ?? kind;
    out.push({ kind: 'data_health', date: a < from ? from : a, text: recovered ? `${name} sync failed for ${hours(end - start)}, synced again ${day(b)}` : `${name} sync failing for ${hours(end - start)} so far` });
  };
  let failing: { id: string; kind: string; at: number } | undefined;
  for (const r of runs) {
    if (failing && failing.id !== r.integration_id) {
      gap(failing.kind, failing.at, now, false);
      failing = undefined;
    }
    if (r.status === 'failed') failing ??= { id: String(r.integration_id), kind: String(r.kind), at: Date.parse(String(r.started_at)) };
    else if (failing) {
      gap(failing.kind, failing.at, Date.parse(String(r.ended)), true);
      failing = undefined;
    }
  }
  if (failing) gap(failing.kind, failing.at, now, false);

  return out.sort((x, y) => x.date.localeCompare(y.date));
}
