import { randomUUID } from 'node:crypto';
import type { ApprovalRequest, PrBrief, PrHistoryRow, PrLinks, PrProductDetail, PrReportBody, PrSpecialistTeam, PrTask, SquadMission } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager } from '../routes/agents';
import { addProducts } from '../routes/agents-actions';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { saveReport } from './reports';

let db: Db;
let app: ReturnType<typeof createApp>;
let p: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  ({ productId: p } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', origin: 'ingest' }));
  refreshProduct(db, p, new Date());
});
const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};
const url = (rest = '') => `/api/pr/products/${p}${rest}?store=pawsome`;
const history = async () => (await send<PrHistoryRow[]>('GET', url('/history'))).body.map((h) => [h.kind, h.from, h.to, h.reason]);

test('owner and linked experiments: who handles it and what it led to, each change in History', async () => {
  expect((await send('PUT', url('/owner'), { owner: 'x'.repeat(81) })).status).toBe(400);
  expect((await send('PUT', url('/owner'), { owner: ' Cody ' })).body).toEqual({ owner: 'Cody' });
  expect((await send<PrProductDetail>('GET', url())).body.owner).toBe('Cody');
  await send('PUT', url('/owner'), { owner: '' });
  expect((await send<PrProductDetail>('GET', url())).body.owner).toBeNull();

  db.prepare(`INSERT INTO kb_cards (id, store_id, category_id, type, title, author_id, origin, created_at, updated_at) VALUES ('c1', 'pawsome', 'general-advertising', 'research_finding', 'Paw-cleaning hooks', 'owner', 'owner', ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO kb_experiments (id, store_id, card_id, metric, plan_json, created_at) VALUES ('e1', 'pawsome', 'c1', 'ctr', '{}', ?), ('e2', 'glow', 'c1', 'ctr', '{}', ?)`).run(new Date().toISOString(), new Date().toISOString());
  expect((await send<PrLinks>('GET', url('/links'))).body).toEqual({ links: [], experiments: [{ id: 'e1', label: 'Paw-cleaning hooks: ctr (planned)' }] });
  expect((await send('POST', url('/links'), { kind: 'experiment', refId: 'e2' })).status).toBe(404); // another store's
  const linked = (await send<PrLinks>('POST', url('/links'), { kind: 'experiment', refId: 'e1' })).body.links;
  expect(linked.map((l) => [l.kind, l.refId, l.label])).toEqual([['experiment', 'e1', 'Paw-cleaning hooks: ctr (planned)']]);
  expect((await send<PrLinks>('DELETE', `/api/pr/products/${p}/links/e1?store=pawsome`)).body.links).toEqual([]);
  expect(await history()).toEqual([
    ['experiment', null, null, 'Unlinked: Paw-cleaning hooks: ctr (planned)'],
    ['experiment', null, null, 'Linked: Paw-cleaning hooks: ctr (planned)'],
    ['owner', 'Cody', null, null],
    ['owner', null, 'Cody', null],
  ]);
});

test('the test brief: prefilled only from stored data (empty fields stay empty) until the owner saves it', async () => {
  const empty = (await send<PrBrief>('GET', url('/brief'))).body;
  expect(empty).toEqual({ fields: { targetCustomer: '', offerHypothesis: '', creativeConcepts: '', measurementPlan: '', budgetAssumptions: '', decisionCriteria: '' }, from: {}, updatedAt: null });

  await send('PUT', '/api/pr/profile?store=pawsome', { audience: 'Dog owners who hike' });
  await send('PUT', url('/economics'), { base: { price: 2900, supplierCost: 800, shipping: 400, feePercent: 3, feePerOrder: 30 } });
  // A real report's proposals prefill; the demo engine's own report never does.
  const t = (await send<PrTask>('POST', '/api/pr/tasks?store=pawsome', { clientRequestId: randomUUID(), productId: p, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.' })).body;
  await runManager(db).idle();
  const report = (over: Partial<PrReportBody>): PrReportBody => ({
    recommendation: 'shortlist', summary: '', purpose: '', customer_problem: '', store_fit: { fit: 'strong', why: '' }, demand_evidence: '', competitors: [], supplier_offers: [],
    risks: [], next_steps: [], evidence: [], open_questions: [], would_change_if: '', proposals: [], unknown_reasons: {}, ...over,
  });
  db.prepare(`UPDATE pr_tasks SET run_id = 'real' WHERE id = ?`).run(t.id); // a model run's report, as in reports.test
  saveReport(db, t.id, report({ proposals: [{ kind: 'ad_angle', text: 'No more wet car seats.' }, { kind: 'ad_angle', text: 'Hydration on the trail.' }, { kind: 'differentiation', text: 'Leak-proof lid.' }] }), { runId: 'real', storeId: 'pawsome', scripted: false });

  const pre = (await send<PrBrief>('GET', url('/brief'))).body;
  expect(pre.fields).toMatchObject({
    targetCustomer: 'Dog owners who hike',
    offerHypothesis: 'Leak-proof lid.',
    creativeConcepts: '- No more wet car seats.\n- Hydration on the trail.',
    measurementPlan: '',
    decisionCriteria: '',
  });
  expect(pre.fields.budgetAssumptions).toMatch(/^Selling price \$29\.00; contribution before ads \$[\d.]+ per order, the most an order can cost to acquire\. Break-even ROAS [\d.]+×\./);
  expect(pre.from).toEqual({ targetCustomer: 'Research profile', offerHypothesis: expect.stringMatching(/^Proposal: report of /), creativeConcepts: expect.stringMatching(/^Proposal: report of /), budgetAssumptions: 'Base economics' });

  expect((await send('PUT', url('/brief'), { fields: { hypothesis: 'x' } })).body).toEqual({ error: 'hypothesis is not a brief field' });
  const saved = (await send<PrBrief>('PUT', url('/brief'), { fields: { ...pre.fields, measurementPlan: ' CTR and add-to-cart over 7 days ' } })).body;
  expect(saved).toMatchObject({ fields: { measurementPlan: 'CTR and add-to-cart over 7 days', targetCustomer: 'Dog owners who hike' }, from: {} });
  expect(saved.updatedAt).not.toBeNull();
  expect((await send<PrBrief>('PUT', url('/brief'), { fields: { decisionCriteria: 'Stop at $40 spend without a sale' } })).body.fields).toMatchObject({ measurementPlan: '', decisionCriteria: 'Stop at $40 spend without a sale' }); // the form sends every field
  expect(db.prepare('SELECT count(*) AS n FROM pr_briefs').get()!.n).toBe(1);
});

test('Prepare draft product: an approval request only (T9), one per product; approving makes a draft that links back', async () => {
  expect((await send('POST', url('/draft-product'))).body).toEqual({ error: 'Set a selling price in Economics (base) first: the draft uses it.' });
  await send('PUT', url('/economics'), { base: { price: 2900, supplierCost: 800 } });
  const first = await send<ApprovalRequest>('POST', url('/draft-product'));
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    status: 'pending',
    title: 'Add "Dog travel water bowl" to Pawsome Gear as a draft',
    action: { kind: 'store.add_products', payload: { products: [{ prProductId: p, title: 'Dog travel water bowl', price: 29, cost: 8 }] } },
  });
  expect(first.body.reason).toContain('nothing is published or bought');
  const again = await send<ApprovalRequest>('POST', url('/draft-product'));
  expect([again.status, again.body.id]).toEqual([200, first.body.id]);
  expect(db.prepare(`SELECT count(*) AS n FROM products WHERE store_id = 'pawsome' AND title = 'Dog travel water bowl'`).get()!.n).toBe(0); // nothing made yet

  // What the approval does once the owner approves it (demo store: a local draft), then the link back.
  await addProducts(db, first.body, () => undefined, async () => []);
  const links = (await send<PrLinks>('GET', url('/links'))).body.links;
  expect(links.map((l) => [l.kind, l.label])).toEqual([['store_product', 'Dog travel water bowl (draft)']]);
  expect((await send('POST', url('/draft-product'))).body).toEqual({ error: 'Already in Pawsome Gear: Dog travel water bowl.' });
});

test('Ask a specialist: a team on the AI Agents team engine, Product Researcher leading, from stored facts only, linked back to the product', async () => {
  expect((await send('GET', url('/specialist').replace('?', '?ask=pricing&'))).status).toBe(400);
  const bare = (await send<PrSpecialistTeam>('GET', `/api/pr/products/${p}/specialist?store=pawsome&ask=positioning`)).body;
  expect(bare.participants).toEqual([{ type: 'product_hunter' }, { type: 'ad_strategist' }]);
  expect(bare.objective).toContain('- Base economics: incomplete (missing selling price, supplier cost, shipping, store fees, store fee per order).');
  await send('PUT', url('/economics'), { base: { price: 2900, supplierCost: 800, shipping: 400, feePercent: 3, feePerOrder: 30 } });
  await send('PUT', url('/brief'), { fields: { targetCustomer: 'Dog owners who hike' } });
  const team = (await send<PrSpecialistTeam>('GET', `/api/pr/products/${p}/specialist?store=pawsome&ask=measurement`)).body;
  expect(team.title).toBe('Dog travel water bowl: measurement plan');
  expect(team.participants).toEqual([{ type: 'product_hunter' }, { type: 'market_analyst' }]);
  expect(team.objective).toMatch(/^Asked from Product Research about "Dog travel water bowl"\. Analytics Specialist: propose a measurement plan/);
  expect(team.objective).toContain('Do not launch, publish or spend anything.');
  expect(team.objective).toMatch(/- Base economics \(the owner's scenario\): selling price \$29\.00, contribution before ads \$[\d.]+ per order, break-even ROAS [\d.]+×\./);
  expect(team.objective).toContain("- Owner's test brief, target customer: Dog owners who hike");

  // The team itself is the AI Agents route's (the client starts it), then linked here.
  const made = await send<SquadMission>('POST', '/api/teams?store=pawsome', { clientRequestId: randomUUID(), ...team });
  expect(made.status).toBe(201);
  expect(made.body.participants?.map((x) => x.type)).toEqual(['product_hunter', 'market_analyst']);
  const links = (await send<PrLinks>('POST', url('/links'), { kind: 'team', refId: made.body.id })).body.links;
  expect(links.map((l) => [l.kind, l.refId, l.label])).toEqual([['team', made.body.id, 'Dog travel water bowl: measurement plan']]);
  expect((await send<PrHistoryRow[]>('GET', url('/history'))).body[0]).toMatchObject({ kind: 'team', reason: 'Asked a specialist: Dog travel water bowl: measurement plan' });

  const theirs = await send<SquadMission>('POST', '/api/teams?store=glow', { clientRequestId: randomUUID(), title: 'Glow team', objective: 'Something for Glow Haus to do.', participants: [{ type: 'product_hunter' }] });
  expect((await send('POST', url('/links'), { kind: 'team', refId: theirs.body.id })).status).toBe(404); // another store's team
});
