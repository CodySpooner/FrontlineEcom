// Impact previews (ST-10, spec §7): what a config save would touch, said only with counts from real queries. One
// function per setting; ST-20 and later items add theirs. Nothing here writes.
import { costToday, workspaceZone } from '@frontline/agents';
import { SETTINGS, startOfDay, type ConfigImpact, type ConfigWrite } from '@frontline/shared';
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
  // Each key quoted: `agentDefaults.model` is one key there, not a nested one.
  const path = `$.${pathIn('store_caps', id).map((k) => JSON.stringify(k)).join('.')}`;
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

/** The AI usage cap moved (decision 10): which way, once a document. Unset falls back to the workspace's, or the built-in one. */
const capMoved: ImpactOf = (db, w, id, value) => {
  const was = capOf(db, id, w.doc === 'store_caps' ? w.storeId : undefined);
  const now = value ?? (w.doc === 'store_caps' ? capOf(db, id) : SETTINGS.find((d) => d.id === id)!.default);
  if (typeof was !== 'number' || typeof now !== 'number' || now === was) return [];
  const text = now > was ? 'Raising it applies to runs that start after' : "Lowering it stops a running run at its next step once today's usage is over the new cap";
  return [{ setting: id, ...(w.doc === 'store_caps' ? { storeId: w.storeId } : {}), text }];
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

/**
 * An agent default moved (ST-20, decision 9): runs going and queued runs with a config keep theirs; queued runs without
 * one read the defaults when they start. Said once per store for the whole save, under its first agent default.
 */
const agentDefault: ImpactOf = (db, w, id) => {
  const ids = [...Object.keys(w.set ?? {}), ...(w.unset ?? [])].filter((k) => k.startsWith('agentDefaults.'));
  if (id !== ids[0]) return [];
  const stores = w.doc === 'store_caps' ? db.prepare('SELECT id, name FROM stores WHERE id = ?').all(w.storeId!) : w.doc === 'workspace' ? overrides(db, id).inherit : [];
  const runs = (storeId: string, where: string) => Number(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE store_id = ? AND ${where}`).get(storeId)!.n);
  // "Stop after" is for new conversations only: a run without a config never reads it.
  const queuedRead = ids.some((k) => k !== 'agentDefaults.stopAfterMin');
  return stores.flatMap((s) => {
    const [keep, take] = [runs(String(s.id), "(status = 'running' OR (status = 'queued' AND config_id IS NOT NULL))"), queuedRead ? runs(String(s.id), "status = 'queued' AND config_id IS NULL") : 0];
    return [
      { setting: id, storeId: String(s.id), text: `Applies to new runs on ${s.name}${keep ? `; ${count(keep, 'running run')} keep${keep === 1 ? 's its' : ' their'} settings` : ''}` },
      ...(take ? [{ setting: id, storeId: String(s.id), text: `${count(take, 'queued run')} on ${s.name} will use the new default` }] : []),
    ];
  });
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

/** Runs at once changed: the next pump reads it, and lowering it never stops a run going (decision 9). Said once a save. */
const atOnce: ImpactOf = (db, w, id) => {
  if ([...Object.keys(w.set ?? {}), ...(w.unset ?? [])].find((k) => k === 'runs.atOnce' || k === 'runs.perStore') !== id) return [];
  const n = Number(db.prepare("SELECT count(*) AS n FROM agent_runs WHERE status = 'running'").get()!.n);
  return [{ setting: id, text: `Applies to the next run that starts; ${count(n, 'run')} going now ${n === 1 ? 'keeps' : 'keep'} going` }];
};

export const IMPACTS: Record<string, ImpactOf[]> = {
  baseCurrency: [rerank],
  timezone: [zoneMoved],
  'caps.agentCostPerDay': [capMoved, runsStopping, workspaceDefault],
  'caps.adSpendChangePerDay': [workspaceDefault],
  'caps.higgsfieldCreditsPerDay': [workspaceDefault],
  'knowledge.autoSave': [workspaceDefault],
  ...Object.fromEntries(['runtime', 'model', 'effort', 'stopAfterMin', 'knowledge'].map((k) => [`agentDefaults.${k}`, [agentDefault]])),
  'runs.atOnce': [atOnce],
  'runs.perStore': [atOnce],
};

/** Every sentence a save of `documents` would earn, before it's made. */
export function impactOf(db: Db, documents: DocWrite[]): ConfigImpact[] {
  return documents.flatMap((w) => [
    ...Object.entries(w.set ?? {}).flatMap(([id, v]) => (IMPACTS[id] ?? []).flatMap((f) => f(db, w, id, v))),
    ...(w.unset ?? []).flatMap((id) => (IMPACTS[id] ?? []).flatMap((f) => f(db, w, id, undefined))),
  ]);
}
