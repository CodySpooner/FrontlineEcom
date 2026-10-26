import { fakeEngine, getAgent, listOrderIssues, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent, OrderIssue } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
let orderId: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  orderId = String(db.prepare(`SELECT id FROM orders WHERE store_id = 'peak' ORDER BY created_at LIMIT 1`).get()?.id);
  db.prepare(`UPDATE orders SET fulfillment_status = 'unfulfilled', tracking = NULL WHERE store_id = 'peak' AND id = ?`).run(orderId); // still waiting
});
const flag = (extra: object = {}): FakeStep => ({
  call: 'flag_order_issue',
  input: { orderId, kind: 'late', severity: 'high', note: 'Unfulfilled 9 days, supplier CJ Dropshipping, no tracking', suggestedAction: 'Ask CJ for tracking today', ...extra },
});
async function run(steps: FakeStep[]) {
  const agent = getAgent(db, 'peak:operations')!;
  const out: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, 'peak')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'tool_result') out.push(e.output);
  }
  return out;
}
const patch = (id: string, body: unknown) => app.request(`/api/order-issues/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('Operations flags order problems once per order and kind; the owner resolves them', async () => {
  const out = await run([flag(), flag({ note: 'still late' }), flag({ kind: 'refund', severity: 'medium' }), flag({ orderId: 'nope' })]);
  expect(out[0]).toMatch(/^Flagged order \S+ \(late, high\) in the issue queue/);
  expect(out[0]).toContain(orderId);
  expect(out[1]).toMatch(/^Order \S+ already has an open late issue \([\w-]+\): Unfulfilled 9 days/);
  expect(out[3]).toBe('No order nope in this store. Use list_orders for ids.');

  const open = (await (await app.request('/api/order-issues?stores=peak&status=open')).json()) as OrderIssue[];
  expect(open.map((i) => [i.kind, i.severity])).toEqual([['refund', 'medium'], ['late', 'high']]);
  expect(open[1]).toMatchObject({ orderId, agentId: 'peak:operations', suggestedAction: 'Ask CJ for tracking today', status: 'open' });

  expect((await patch(open[1]!.id, { status: 'done' })).status).toBe(400);
  expect((await patch('nope', { status: 'resolved' })).status).toBe(404);
  expect(await (await patch(open[1]!.id, { status: 'resolved', resolution: 'CJ shipped it, tracking sent' })).json()).toMatchObject({
    status: 'resolved', resolution: 'CJ shipped it, tracking sent', resolvedAt: expect.any(String),
  });
  // Resolved issues sort last, and the same problem can be flagged again later.
  expect((await run([flag()]))[0]).toMatch(/^Flagged order/);
  expect(listOrderIssues(db, { storeIds: ['peak'] }).map((i) => [i.kind, i.status])).toEqual([['late', 'open'], ['refund', 'open'], ['late', 'resolved']]);
  expect((await app.request('/api/order-issues?status=closed')).status).toBe(400);
});

test('issues the order has since answered close themselves: delivered, or supplier tracking arrived', async () => {
  const other = String(db.prepare(`SELECT id FROM orders WHERE store_id = 'peak' AND id != ? ORDER BY created_at LIMIT 1`).get(orderId)?.id);
  db.prepare(`UPDATE orders SET fulfillment_status = 'unfulfilled', tracking = NULL WHERE store_id = 'peak' AND id = ?`).run(other);
  await run([flag(), flag({ kind: 'supplier' }), flag({ kind: 'address' }), flag({ orderId: other, kind: 'supplier' })]);
  const open = async () => ((await (await app.request('/api/order-issues?stores=peak&status=open')).json()) as OrderIssue[]).map((i) => `${i.orderId === orderId ? 'a' : 'b'}:${i.kind}`).sort();
  expect(await open()).toEqual(['a:address', 'a:late', 'a:supplier', 'b:supplier']);

  db.prepare(`UPDATE orders SET tracking = 'CJ123' WHERE store_id = 'peak' AND id = ?`).run(other);
  expect(await open()).toEqual(['a:address', 'a:late', 'a:supplier']);
  db.prepare(`UPDATE orders SET fulfillment_status = 'delivered' WHERE store_id = 'peak' AND id = ?`).run(orderId);
  expect(await open()).toEqual(['a:address']);
  expect(listOrderIssues(db, { status: 'resolved' }).map((i) => i.resolution).sort()).toEqual([
    'Delivered; closed automatically.', 'Delivered; closed automatically.', 'Supplier shipped (tracking CJ123); closed automatically.',
  ]);
});
