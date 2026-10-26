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
  // A day-8 re-flag at high raises a day-3 medium refund issue; a lower one leaves it as it is.
  const raised = await run([flag({ kind: 'refund', severity: 'high', note: 'Refund asked 8 days ago, no reply' }), flag({ kind: 'refund', severity: 'low', note: 'customer is calmer now' })]);
  expect(raised[0]).toMatch(/^Raised order \S+'s open refund issue \([\w-]+\) to high\.$/);
  expect(raised[1]).toMatch(/already has an open refund issue \([\w-]+\): Refund asked 8 days ago, no reply$/);

  const open = (await (await app.request('/api/order-issues?stores=peak&status=open')).json()) as OrderIssue[];
  expect(open.map((i) => [i.kind, i.severity])).toEqual([['refund', 'high'], ['late', 'high']]);
  expect(open[0]!.suggestedAction).toBe('Ask CJ for tracking today'); // kept: the re-flag named no new step
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
  // Reopening the old one while the new one is open: one open issue per order and kind, so the owner is told why.
  const res = await patch(open[1]!.id, { status: 'open' });
  expect([res.status, await res.json()]).toEqual([409, { error: `Order ${orderId} already has a newer open late issue: work that one.` }]);
  expect(listOrderIssues(db, { storeIds: ['peak'], status: 'open' }).map((i) => i.kind)).toEqual(['late', 'refund']);
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
  // The owner reopens one (delivered, but the customer says it never came): it stays open, though the order still says delivered.
  const late = listOrderIssues(db, { status: 'resolved' }).find((i) => i.orderId === orderId && i.kind === 'late')!;
  expect((await patch(late.id, { status: 'open' })).status).toBe(200);
  expect(await open()).toEqual(['a:address', 'a:late']);
});

test("a refunded or cancelled order closes its issues, and the agent's list sees it without the owner's page open", async () => {
  await run([flag({ kind: 'refund', severity: 'medium', note: 'Customer asked for a refund: wrong size' }), flag({ kind: 'address' }), flag({ kind: 'other', note: 'Chargeback opened by the bank' })]);
  db.prepare(`UPDATE orders SET status = 'refunded' WHERE store_id = 'peak' AND id = ?`).run(orderId);
  const [list] = await run([{ call: 'list_order_issues' }]);
  expect(list!.split('\n').slice(1).map((r) => r.split(',').slice(1, 4).join(','))).toEqual(['other,high,open', 'address,high,resolved', 'refund,medium,resolved']);
  expect(list).toContain('Order refunded or cancelled; closed automatically.');
});

test('list_order_issues shows the open queue first, then resolutions the owner wrote', async () => {
  await run([flag(), flag({ kind: 'refund', severity: 'medium', note: 'Customer asked for a refund: wrong size' })]);
  const refund = String(db.prepare(`SELECT id FROM order_issues WHERE kind = 'refund'`).get()?.id);
  expect((await patch(refund, { status: 'resolved', resolution: 'Sent the right size; supplier swaps for free' })).status).toBe(200);
  const [list] = await run([{ call: 'list_order_issues' }]);
  const [header, ...rows] = list!.split('\n');
  expect(header).toBe('order_id,kind,severity,status,opened,resolved,note,suggested_action,resolution');
  expect(rows.map((r) => r.split(',').slice(1, 4).join(','))).toEqual(['late,high,open', 'refund,medium,resolved']);
  expect(rows[1]).toMatch(/,Sent the right size; supplier swaps for free$/);
  expect((await run([{ call: 'list_order_issues', input: { status: 'open' } }]))[0]!.split('\n')).toHaveLength(2);
});

test('list_orders with stale lists only late orders, oldest first, however many newer orders there are', async () => {
  const [late, slow, fresh] = db.prepare(`SELECT id FROM orders WHERE store_id = 'peak' ORDER BY created_at DESC LIMIT 3`).all().map((r) => String(r.id));
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare(`UPDATE orders SET fulfillment_status = 'delivered' WHERE store_id = 'peak'`).run();
  const set = db.prepare(`UPDATE orders SET created_at = ?, local_date = ?, fulfillment_status = ? WHERE store_id = 'peak' AND id = ?`);
  set.run(ago(5), ago(5).slice(0, 10), 'unfulfilled', late!);
  set.run(ago(20), ago(20).slice(0, 10), 'in_transit', slow!);
  set.run(ago(1), ago(1).slice(0, 10), 'unfulfilled', fresh!); // not late yet
  const cancelled = String(db.prepare(`SELECT id FROM orders WHERE store_id = 'peak' AND id NOT IN (?, ?, ?) LIMIT 1`).get(late!, slow!, fresh!)?.id);
  set.run(ago(6), ago(6).slice(0, 10), 'unfulfilled', cancelled);
  db.prepare(`UPDATE orders SET status = 'refunded' WHERE store_id = 'peak' AND id = ?`).run(cancelled); // cancelled before shipping
  const [out] = await run([{ call: 'list_orders', input: { days: 30, stale: true, limit: 5 } }]);
  expect(out!.split('# Orders\n')[1]!.split('\n').slice(1).map((r) => r.split(',')[0])).toEqual([slow, late]);
  const [cut] = await run([{ call: 'list_orders', input: { days: 30, limit: 2 } }]);
  expect(cut).toContain('# Orders (the newest 2; older ones are cut: stale true lists the late ones, oldest first)\n');
});

test('list_orders scores each supplier over every order in the window, not just the rows shown', async () => {
  const [late, slow, refunded] = db.prepare(`SELECT id FROM orders WHERE store_id = 'peak' ORDER BY created_at DESC LIMIT 3`).all().map((r) => String(r.id));
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const set = db.prepare(`UPDATE orders SET supplier = 'Slow Co', created_at = ?, fulfillment_status = ?, status = ? WHERE store_id = 'peak' AND id = ?`);
  set.run(ago(5), 'unfulfilled', 'paid', late!);
  set.run(ago(12), 'in_transit', 'paid', slow!);
  set.run(ago(20), 'delivered', 'refunded', refunded!);
  orderId = late!;
  const [, out] = await run([flag(), { call: 'list_orders', input: { days: 30, limit: 1 } }]);
  expect(out).toMatch(/\n# By supplier\nsupplier,orders,unfulfilled_3d_plus,in_transit_10d_plus,refunded,open_issues\n/);
  expect(out).toContain('\nSlow Co,3,1,1,1,1\n');
});
