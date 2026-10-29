// Impact previews (ST-10, spec §7): what a config save would touch, said only with counts from real queries. One
// function per setting; ST-20 and later items add theirs. Nothing here writes.
import type { ConfigImpact, ConfigWrite } from '@frontline/shared';
import type { Db } from '../db';
import { effective, pathIn } from './effective';

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

export const IMPACTS: Record<string, ImpactOf[]> = {
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
