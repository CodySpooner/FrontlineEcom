import { APP_TOOLS, callTool, ensureSquads, getAgent, type ToolContext } from '@frontline/agents';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { approvalsHook, getApproval } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
beforeEach(() => {
  db = openDb(); seedDemo(db); ensureSquads(db);
  db.prepare('DELETE FROM approvals').run();
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
});
afterEach(() => db.close());

test.each([
  { tool: 'propose_ad_change', input: { campaignId: 'glow-c1', change: 'pause', evidence: 'Losing for seven days' } },
  { tool: 'request_approval', input: { title: 'New product', reason: 'Demand evidence', kind: 'store.add_products', amount: 10, payload: { products: [{ title: 'Brand new item', price: 20 }] } } },
])('$tool rechecks duplicates after its currency lookup', async ({ tool, input }) => {
  const ctx: ToolContext = {
    ...toolEnv(db), store: getStore(db, 'glow')!, agent: getAgent(db, 'glow:ad_strategist')!, emit: () => {},
    toUsd: async (amount) => amount,
    approvals: { ...approvalsHook(db), decision: async (id) => ({ ...getApproval(db, id)!, status: 'denied' }) },
  };
  const t = APP_TOOLS.find((t) => t.name === tool)!;
  const results = await Promise.all([callTool(t, input, ctx), callTool(t, input, ctx)]);
  expect(db.prepare('SELECT count(*) AS n FROM approvals').get()?.n).toBe(1);
  expect(results.filter((r) => /already.*waiting/.test(r.output))).toHaveLength(1);
});
