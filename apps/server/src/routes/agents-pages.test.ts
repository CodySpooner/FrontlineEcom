import { fakeEngine, getAgent, listPageDrafts, runAgent, savePageDraft, type FakeStep } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, PageDraft } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { decide, getApproval } from '../approvals';
import { publish, subscribe } from '../live';
import { getStore } from '../stores';
import { toolEnv } from './agents';
import { onDecision, publishDraft } from './agents-actions';

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

test("archived products (deleted on the platform) get no page drafts or publish requests", async () => {
  const [saved] = await run(() => [draft()]);
  expect(saved).toMatch(/^Saved draft/);
  db.prepare(`UPDATE products SET status = 'archived' WHERE store_id = 'glow' AND id = 'p-new'`).run();
  const id = listPageDrafts(db)[0]!.id;
  expect(await run(() => [{ call: 'publish_page', input: { draftId: id } }, draft({ title: 'Again' })], 'approve')).toEqual([
    'Not sent: Product p-new is archived (deleted or trashed on the platform). Pick an active product from list_products.',
    'Product p-new is archived (deleted or trashed on the platform). Pick an active product from list_products.',
  ]);
  expect(db.prepare(`SELECT count(*) AS n FROM approvals WHERE store_id = 'glow' AND action_json LIKE '%store.publish_page%'`).get()?.n).toBe(0);
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

test("publishing a draft the owner turned down doesn't say the no again (it would be remembered twice)", async () => {
  await run(() => [draft()]);
  await run(() => [{ call: 'publish_page', input: { draftId: listPageDrafts(db)[0]!.id } }], 'deny');
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run();
  const said: string[] = [];
  const stop = subscribe((m) => m.type === 'approval' && said.push(m.approval.status));
  await publishDraft(db, listPageDrafts(db)[0]!, async () => {});
  stop();
  expect(listPageDrafts(db)[0]?.status).toBe('published');
  expect(said).toEqual([]);
});

test('connected stores get it on the platform; a platform error tells the owner; bad input is refused', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run();
  const out = await run(() => [draft({ productId: 'nope' }), draft({ productId: undefined }), draft({ kind: 'page', productId: undefined, title: 'About us' })]);
  expect(out.slice(0, 2)).toEqual(['No product nope in this store. Use list_products for ids.', 'productId is required for a product page.']);
  const [about] = listPageDrafts(db);
  await run(() => [{ call: 'publish_page', input: { draftId: about!.id } }], 'approve');
  expect(listPageDrafts(db)[0]?.status).toBe('approved');
  expect(db.prepare(`SELECT title, body FROM notifications WHERE kind = 'error' AND store_id = 'glow'`).get()).toEqual({
    title: 'Couldn\'t publish "About us" to Glow Haus',
    body: "Shopify is not connected for this store. It's approved and waiting in Store Builder.",
  });

  const pushed: string[] = [];
  const seen: string[] = []; // what the Store Builder reads when the live message tells it to refetch
  const stop = subscribe((m) => m.type === 'approval' && seen.push(listPageDrafts(db)[0]!.status));
  await publishDraft(db, listPageDrafts(db)[0]!, async (d) => pushed.push(d.title));
  stop();
  expect(pushed).toEqual(['About us']);
  expect(listPageDrafts(db)[0]?.status).toBe('published');
  expect(seen).toEqual(['published']);
});

test('Etsy takes product pages (to the listing) but not other pages', async () => {
  db.prepare(`UPDATE stores SET connected = 1, platform = 'etsy' WHERE id = 'glow'`).run();
  await run(() => [draft(), draft({ kind: 'page', productId: undefined, title: 'About us' })]);
  const [about, page] = listPageDrafts(db);
  expect((await run(() => [{ call: 'publish_page', input: { draftId: about!.id } }], 'approve'))[0]).toMatch(/^Not sent: the app doesn't change etsy stores yet/);
  await run(() => [{ call: 'publish_page', input: { draftId: page!.id } }], 'approve');
  expect(db.prepare(`SELECT body FROM notifications WHERE kind = 'error' AND store_id = 'glow'`).get()?.body).toBe("p-new is not an Etsy listing. It's approved and waiting in Store Builder.");
});

test('a decision said twice on the live bus runs its action once', async () => {
  const runs: string[] = [];
  onDecision(db, 'approved', (_, a) => runs.push(a.id));
  const a = db.prepare(`SELECT id FROM approvals WHERE status = 'pending' LIMIT 1`).get()!;
  decide(db, String(a.id), 'approve');
  publish({ type: 'approval', approval: getApproval(db, String(a.id))! });
  await tick();
  expect(runs).toEqual([String(a.id)]);
});

test('a draft with active HTML is refused, and one saved before the check never reaches the storefront', async () => {
  const [out] = await run(() => [draft({ html: '<p>Great roller.</p><img src=x onerror="fetch(1)">' })]);
  expect(out).toBe('Not saved: the onerror attribute is not allowed in a storefront page. Use headings, paragraphs, lists, tables, images and http(s) links only.');
  expect(listPageDrafts(db)).toEqual([]);

  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run();
  const old = savePageDraft(db, { storeId: 'glow', agentId: 'glow:store_developer', kind: 'page', title: 'About us', html: '<p>Hi</p><script src="https://x.js"></script>', notes: 'from before the check' });
  await run(() => [{ call: 'publish_page', input: { draftId: old.id } }], 'approve');
  expect(db.prepare(`SELECT body FROM notifications WHERE kind = 'error' AND store_id = 'glow'`).get()?.body).toBe(
    "The draft has HTML a storefront must not run (<script> is not allowed); ask the Store Developer for a clean draft. It's approved and waiting in Store Builder.",
  );
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

test('discarding a draft whose publish request waits denies the request (approving it later would publish nothing)', async () => {
  await run(() => [draft()]);
  const [d] = listPageDrafts(db);
  const waiting = run(() => [{ call: 'publish_page', input: { draftId: d!.id } }]);
  await tick();
  const { approvalId } = listPageDrafts(db)[0]!;
  expect((await app.request(`/api/page-drafts/${d!.id}`, { method: 'DELETE' })).status).toBe(204);
  await waiting; // the run that asked hears no
  expect(db.prepare('SELECT status, decision_note FROM approvals WHERE id = ?').get(approvalId!)).toEqual({ status: 'denied', decision_note: 'The owner discarded the draft in the Store Builder.' });
}, 3000);

test('best sellers come first, and a product gets one page test at a time', async () => {
  db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', 'o-roller', ?, 39.8, 'paid', 'delivered', date('now'))`).run(new Date().toISOString());
  db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('glow', 'o-roller', 'p-new', 2, 39.8, 5.2)`).run();
  const [catalog] = await run(() => [{ call: 'list_products' }]);
  expect(catalog!.split('\n')[1]).toMatch(/^p-new,Ice roller,.*,2,39\.8$/);

  const out = await run(() => [draft(), draft()]);
  expect(out[1]).toBe(`Not saved: this product already has a page draft in Store Builder (${listPageDrafts(db)[0]!.id}). The owner publishes or rejects it first; work on another product.`);
  const live = (daysAgo: number) => db.prepare(`UPDATE page_drafts SET published_at = datetime('now', ?)`).run(`-${daysAgo} days`);
  live(10);
  expect((await run(() => [draft()]))[0]).toMatch(/^Not saved: this product's page went live on \d{4}-\d{2}-\d{2} and is judged after 14 days of sales/);
  live(40);
  expect((await run(() => [draft()]))[0]).toMatch(/^Saved draft /);
});
