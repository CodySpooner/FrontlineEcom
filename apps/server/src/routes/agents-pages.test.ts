import { fakeEngine, getAgent, listPageDrafts, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, PageDraft } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  db.prepare(`INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', 'p-new', 'Ice roller', 19.9, 2.6, 0, 'draft')`).run();
});
const tick = () => new Promise((r) => setImmediate(r));
const draft = (extra: object = {}): FakeStep => ({
  call: 'draft_page',
  input: {
    kind: 'product', productId: 'p-new', title: 'Ice Facial Roller — Depuff in 60 Seconds', html: '<p>Cool, calm skin every morning.</p><ul><li>Stainless steel</li></ul>',
    seoTitle: 'Ice Facial Roller | Glow Haus', notes: 'New product page: benefit-led title, 5 bullets; priced at $19.90 vs competitors $17–24.', ...extra,
  },
});

/** Runs the steps as the Glow Store Developer; `answer` decides publish requests. Returns tool outputs. */
async function run(steps: (drafts: PageDraft[]) => FakeStep[], answer?: ApprovalDecision) {
  const agent = getAgent(db, 'glow:store_developer')!;
  const out: string[] = [];
  const env = toolEnv(db);
  for await (const e of runAgent({ agent, store: getStore(db, 'glow')!, task: 't', env }, fakeEngine(() => steps(listPageDrafts(db)))) as AsyncIterable<AgentEvent>) {
    if (e.type === 'approval_request' && answer) decide(db, e.approval.id, answer);
    if (e.type === 'tool_result') out.push(e.output);
  }
  await tick();
  return out;
}
const product = () => db.prepare(`SELECT title, status FROM products WHERE store_id = 'glow' AND id = 'p-new'`).get();

test('a product page is drafted, its publish request approved, and it goes live with the product', async () => {
  expect((await run(() => [draft()]))[0]).toMatch(/^Saved draft [\w-]+ to the Store Builder\./);
  const [d] = listPageDrafts(db, { storeIds: ['glow'] });
  expect(d).toMatchObject({ kind: 'product', productId: 'p-new', status: 'draft', agentId: 'glow:store_developer', seoTitle: 'Ice Facial Roller | Glow Haus' });

  const out = await run(() => [{ call: 'publish_page', input: { draftId: d!.id } }], 'approve');
  expect(out[0]).toMatch(/^Approved by the owner: .*\. Publishing it now\.$/);
  expect(listPageDrafts(db)[0]).toMatchObject({ status: 'published', publishedAt: expect.any(String), approvalId: expect.any(String) });
  expect(product()).toEqual({ title: 'Ice Facial Roller — Depuff in 60 Seconds', status: 'active' });
  expect((await run(() => [{ call: 'publish_page', input: { draftId: d!.id } }]))[0]).toBe('That draft is already published.');
});

test('denied requests leave the draft rejected; the owner can still publish it from the Store Builder', async () => {
  await run(() => [draft()]);
  const [d] = listPageDrafts(db);
  await run(() => [{ call: 'publish_page', input: { draftId: d!.id } }], 'deny');
  expect(listPageDrafts(db, { status: 'rejected' })).toHaveLength(1);
  expect(product()?.status).toBe('draft');

  const res = await app.request(`/api/page-drafts/${d!.id}/publish`, { method: 'POST' });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'published' });
  expect(product()?.status).toBe('active');
  expect((await app.request(`/api/page-drafts/${d!.id}/publish`, { method: 'POST' })).status).toBe(409);
});

test('connected stores are told to apply it; bad input is refused', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run();
  const out = await run(() => [draft({ productId: 'nope' }), draft({ productId: undefined }), draft({ kind: 'page', productId: undefined, title: 'About us' })]);
  expect(out.slice(0, 2)).toEqual(['No product nope in this store. Use list_products for ids.', 'productId is required for a product page.']);
  const [about] = listPageDrafts(db);
  await run(() => [{ call: 'publish_page', input: { draftId: about!.id } }], 'approve');
  expect(listPageDrafts(db)[0]?.status).toBe('approved');
  expect(db.prepare(`SELECT title FROM notifications WHERE kind = 'info' AND store_id = 'glow'`).get()?.title).toBe('Publish on Glow Haus by hand: About us');
});

test('Store Builder routes', async () => {
  await run(() => [draft(), draft({ kind: 'page', productId: undefined, title: 'FAQ' })]);
  const all = (await (await app.request('/api/page-drafts?stores=glow')).json()) as PageDraft[];
  expect(all.map((d) => d.title)).toEqual(['FAQ', 'Ice Facial Roller — Depuff in 60 Seconds']);
  expect(await (await app.request('/api/page-drafts?stores=pawsome')).json()).toEqual([]);
  expect((await app.request('/api/page-drafts?status=live')).status).toBe(400);
  expect(((await (await app.request(`/api/page-drafts/${all[0]!.id}`)).json()) as PageDraft).html).toContain('Cool, calm skin');

  // A pending request is approved through the approvals flow (202), then published by the watcher.
  const pending = run(() => [{ call: 'publish_page', input: { draftId: all[1]!.id } }]);
  await tick();
  const res = await app.request(`/api/page-drafts/${all[1]!.id}/publish`, { method: 'POST' });
  expect(res.status).toBe(202);
  await pending;
  expect(listPageDrafts(db, { status: 'published' }).map((d) => d.title)).toEqual(['Ice Facial Roller — Depuff in 60 Seconds']);

  expect((await app.request(`/api/page-drafts/${all[0]!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/page-drafts/${all[0]!.id}`)).status).toBe(404);
});
