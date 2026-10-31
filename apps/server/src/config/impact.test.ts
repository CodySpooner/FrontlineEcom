import { expect, test } from 'vitest';
import type { ConfigImpact } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { bootConfig } from './boot';

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  bootConfig(db); // the workspace caps, as a real install has them
  return { db, app: createApp(db) };
};
const impact = async (app: ReturnType<typeof createApp>, documents: unknown) => {
  const res = await app.request('/api/config/impact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documents }) });
  return { status: res.status, body: (await res.json()) as { impacts: ConfigImpact[] } & { error?: string } };
};
const runs = (db: Db, store: string, status: string, n: number) => {
  for (let i = 0; i < n; i++)
    db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, created_at) VALUES (?, ?, ?, 'T', ?, '2026-10-28T09:00:00.000Z')").run(`${store}-${status}-${i}`, store, `${store}:market_analyst`, status);
};
/** The fixture's counts, by its own queries. */
const n = (db: Db, sql: string, ...args: string[]) => Number(db.prepare(sql).get(...args)?.n);

test("a lowered AI usage cap names the runs going now on each store it reaches, and a workspace default counts who takes it", async () => {
  const { db, app } = setup();
  runs(db, 'glow', 'running', 2);
  runs(db, 'glow', 'done', 3); // finished: out of it
  runs(db, 'peak', 'running', 1);
  db.prepare("INSERT INTO store_caps (store_id, value_json) VALUES ('peak', '{\"agentCostPerDay\": 8}')").run(); // Peak Fit keeps its own
  const stores = n(db, 'SELECT count(*) AS n FROM stores');

  const lowered = await impact(app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 2 } }]);
  expect(lowered.status).toBe(200);
  expect(lowered.body.impacts).toEqual([
    { setting: 'caps.agentCostPerDay', text: "Lowering it stops a running run at its next step once today's usage is over the new cap" },
    { setting: 'caps.agentCostPerDay', storeId: 'glow', text: `${n(db, "SELECT count(*) AS n FROM agent_runs WHERE store_id = 'glow' AND status = 'running'")} running runs on Glow Haus stop at their next step if they go over` },
    { setting: 'caps.agentCostPerDay', text: `Applies to ${stores - 1} stores that use the workspace default; 1 store has its own value` },
  ]);

  // Peak Fit's own cap lowered below what it has: its one run; raised, nothing stops.
  expect((await impact(app, [{ doc: 'store_caps', storeId: 'peak', version: 1, set: { 'caps.agentCostPerDay': 3 } }])).body.impacts).toEqual([
    { setting: 'caps.agentCostPerDay', storeId: 'peak', text: "Lowering it stops a running run at its next step once today's usage is over the new cap" },
    { setting: 'caps.agentCostPerDay', storeId: 'peak', text: '1 running run on Peak Fit stops at its next step if it goes over' },
  ]);
  expect((await impact(app, [{ doc: 'store_caps', storeId: 'peak', version: 1, set: { 'caps.agentCostPerDay': 20 } }])).body.impacts).toEqual([
    { setting: 'caps.agentCostPerDay', storeId: 'peak', text: 'Raising it applies to runs that start after' },
  ]);
  // Back to the workspace's 5 from its own 8: lowered too.
  expect((await impact(app, [{ doc: 'store_caps', storeId: 'peak', version: 1, unset: ['caps.agentCostPerDay'] }])).body.impacts.map((i) => i.text)).toEqual([
    "Lowering it stops a running run at its next step once today's usage is over the new cap",
    '1 running run on Peak Fit stops at its next step if it goes over',
  ]);

  // No run going: no count to show. Other caps: the stores sentence only.
  db.prepare("UPDATE agent_runs SET status = 'done'").run();
  expect((await impact(app, [{ doc: 'workspace', version: 1, set: { 'caps.agentCostPerDay': 1, 'caps.adSpendChangePerDay': 50 } }])).body.impacts.map((i) => i.text)).toEqual([
    "Lowering it stops a running run at its next step once today's usage is over the new cap",
    `Applies to ${stores - 1} stores that use the workspace default; 1 store has its own value`,
    `Applies to ${stores} stores that use the workspace default; 0 stores have their own value`,
  ]);
  expect(n(db, 'SELECT count(*) AS n FROM settings_changes')).toBe(n(db, "SELECT count(*) AS n FROM settings_changes WHERE actor = 'migration'")); // a preview writes nothing
  expect((await impact(app, [{ doc: 'nope' }])).status).toBe(400);
});
