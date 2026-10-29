// Impact previews (ST-10, spec §7): what a config save would touch, said only with counts from real queries. One
// function per setting; ST-20 and later items add theirs. Nothing here writes.
import { costToday, workspaceZone } from '@frontline/agents';
import { startOfDay, type ConfigImpact, type ConfigWrite } from '@frontline/shared';
import { nextCronTime, parseCron } from '../cron';
import type { Db } from '../db';
import { getCaps } from '../settings';
import { rankedProducts } from './apply';
import { effective, pathIn } from './effective';
import { validZone } from './write';

type DocWrite = ConfigWrite['documents'][number];
/** One setting's sentences for one document's change (`value` undefined: unset, back to inheriting). */
type ImpactOf = (db: Db, w: DocWrite, id: string, value: unknown) => ConfigImpact[];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capOf = (db: Db, id: string, storeId?: string) => effective(db, { storeId }).values[id];

/** Stores that keep their own value for a store_caps entry (any key there, as effective() reads it), and the rest. */
function overrides(db: Db, id: string) {
  const path = `$.${pathIn('store_caps', id).join('.')}`;
  const own = db.prepare('SELECT s.id, s.name FROM stores s JOIN store_caps c ON c.store_id = s.id WHERE json_type(c.value_json, ?) IS NOT NULL ORDER BY s.name').all(path);
  const inherit = db.prepare('SELECT id, name FROM stores WHERE id NOT IN (SELECT store_id FROM store_caps WHERE json_type(value_json, ?) IS NOT NULL) ORDER BY name').all(path);
  return { own, inherit };
}

/** A workspace default: how many stores take it, how many keep their own. */
const workspaceDefault: ImpactOf = (db, w, id) => {
  if (w.doc !== 'workspace') return [];
  const { own, inherit } = overrides(db, id);
  return [{ setting: id, text: `Applies to ${count(inherit.length, 'store')} that use${inherit.length === 1 ? 's' : ''} the workspace default; ${count(own.length, 'store')} ${own.length === 1 ? 'has its' : 'have their'} own value` }];
};

/** The AI usage cap lowered: runs going now re-read it at each step (packages/agents/src/runs.ts, `spend`). */
const runsStopping: ImpactOf = (db, w, id, value) => {
  const stores =
    w.doc === 'store_caps'
      ? db.prepare('SELECT id, name FROM stores WHERE id = ?').all(w.storeId!)
      : w.doc === 'workspace'
        ? overrides(db, id).inherit
        : [];
  const running = db.prepare("SELECT count(*) AS n FROM agent_runs WHERE store_id = ? AND status = 'running'");
  return stores.flatMap((s) => {
    const was = capOf(db, id, String(s.id));
    const now = value === undefined ? capOf(db, id) : value; // unset: back to the workspace's
    if (typeof was !== 'number' || typeof now !== 'number' || now >= was) return [];
    const n = Number(running.get(String(s.id))?.n);
    return n ? [{ setting: id, storeId: String(s.id), text: `${count(n, 'running run')} on ${s.name} ${n === 1 ? 'stops at its next step if it goes' : 'stop at their next step if they go'} over` }] : [];
  });
};

/** The display currency moved: its apply job ranks every product again for All stores. */
const rerank: ImpactOf = (db, w, id, value) => {
  const n = rankedProducts(db).length;
  return w.doc === 'app' && value !== undefined && n ? [{ setting: id, text: `Re-ranks All-stores facts for ${count(n, 'product')}` }] : [];
};

// Times on screen are this computer's clock (decision 8).
const here = (d: Date) => d.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const usd = (n: number) => `$${n.toFixed(2)}`;

/** The workspace timezone moved: each enabled schedule's next run, before → after, and where today's counters restart. */
const zoneMoved: ImpactOf = (db, w, id, value) => {
  const was = workspaceZone(db);
  if (w.doc !== 'workspace' || typeof value !== 'string' || value === was || !validZone(value)) return [];
  const now = new Date();
  const next = (cron: string, zone: string) => {
    const at = nextCronTime(parseCron(cron), now, 8, zone);
    return at ? here(at) : 'none within a week';
  };
  const rules = db.prepare('SELECT r.name, r.trigger_json, s.name AS store FROM automation_rules r JOIN stores s ON s.id = r.store_id WHERE r.enabled = 1 ORDER BY s.name, r.name').all();
  const schedules = rules.flatMap((r) => {
    const t = JSON.parse(String(r.trigger_json)) as { type: string; cron?: string };
    return t.type === 'schedule' && t.cron ? [{ setting: id, text: `${r.name} on ${r.store}: next run ${next(t.cron, was)} → ${next(t.cron, value)}` }] : [];
  });
  const usage = db.prepare('SELECT id, name FROM stores ORDER BY name').all().flatMap((s) => {
    const [before, after] = [costToday(db, String(s.id), undefined, was), costToday(db, String(s.id), undefined, value)];
    return before === after ? [] : [`AI usage today becomes ${usd(after)} of ${usd(getCaps(db, String(s.id)).agentCostPerDay)} on ${s.name}`];
  });
  // ponytail: a day later's midnight is the next one, except across a DST change at midnight itself.
  const restart = new Date(startOfDay(value, new Date(now.getTime() + 86_400_000)));
  return [...schedules, { setting: id, text: `Today's usage counters restart at ${here(restart)} (midnight ${value})${usage.length ? `: ${usage.join('; ')}` : ''}` }];
};

export const IMPACTS: Record<string, ImpactOf[]> = {
  baseCurrency: [rerank],
  timezone: [zoneMoved],
  'caps.agentCostPerDay': [runsStopping, workspaceDefault],
  'caps.adSpendChangePerDay': [workspaceDefault],
  'caps.higgsfieldCreditsPerDay': [workspaceDefault],
};

/** Every sentence a save of `documents` would earn, before it's made. */
export function impactOf(db: Db, documents: DocWrite[]): ConfigImpact[] {
  return documents.flatMap((w) => [
    ...Object.entries(w.set ?? {}).flatMap(([id, v]) => (IMPACTS[id] ?? []).flatMap((f) => f(db, w, id, v))),
    ...(w.unset ?? []).flatMap((id) => (IMPACTS[id] ?? []).flatMap((f) => f(db, w, id, undefined))),
  ]);
}
