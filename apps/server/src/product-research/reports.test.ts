import { APP_TOOLS, callTool, createRunManager, getAgent, getRun } from '@frontline/agents';
import type { PrProductDetail, PrReport, PrReportBody, PrTask } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { runManager, toolEnv } from '../routes/agents';
import { getStore } from '../stores';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { canonicalUrl, checkUrl, preview } from './preview';
import { saveReport } from './reports';
import { taskMessage } from './tasks';

let db: Db;
let app: ReturnType<typeof createApp>;
let p: string;
let listing: string;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  const url = 'https://cjdropshipping.com/p/1';
  ({ productId: p, id: listing } = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Dog travel water bowl', category: 'Pet Supplies > Travel', url, canonicalUrl: canonicalUrl(new URL(url)), origin: 'ingest' }));
  refreshProduct(db, p, new Date());
});

const send = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const idle = () => runManager(db).idle();
const task = async (body: Record<string, unknown> = {}) => {
  const t = await json<PrTask>(send('POST', '/api/pr/tasks?store=pawsome', { clientRequestId: randomUUID(), productId: p, type: 'product_hunter', mode: 'new', instructions: 'Evaluate it.', ...body }));
  await idle();
  return t;
};
const reports = () => json<PrReport[]>(send('GET', `/api/pr/products/${p}/reports?store=pawsome`));
const body = (over: Partial<PrReportBody> = {}): PrReportBody => ({
  recommendation: 'shortlist', summary: 'Worth a small test at $29.', purpose: 'Keeps a dog hydrated on walks.', customer_problem: 'Spills from open bowls.',
  store_fit: { fit: 'strong', why: 'Pet travel is the niche.' }, demand_evidence: 'Steady interest on Google Trends.',
  competitors: [{ name: 'https://example.com/bowl', price: '$24.99', source: 'https://example.com/bowl' }], supplier_offers: [], risks: ['Leaks if the seal fails.'],
  next_steps: ['Order one sample.'], evidence: [{ claim: 'Listed on CJ', kind: 'measured', source: `[listing:${listing}]` }], open_questions: ['Real shipping time to the US?'],
  would_change_if: 'Shipping over 15 days.', proposals: [{ kind: 'ad_angle', text: 'No more wet car seats.' }], unknown_reasons: { supplier_offers: 'No offer checked yet.' }, ...over,
});

test('the scripted engine saves one labelled demo report that feeds nothing; a real one feeds the assessment and the next task', async () => {
  const t = await task();
  const run = (await json<{ transcript: { type: string; name?: string; output?: string }[] }>(send('GET', `/api/runs/${t.runId}`))).transcript;
  expect(run.find((e) => e.type === 'tool_result')?.output).toBe('Report saved as a demo: Product Research shows it as a scripted example, not research.');
  const [demo] = await reports();
  expect(demo).toMatchObject({ taskId: t.id, runId: t.runId, conversationId: t.conversationId, runtime: 'demo', demo: true, body: { recommendation: 'research_further' } });
  expect((await json<PrTask>(send('GET', `/api/pr/tasks/${t.id}?store=pawsome`))).status).toBe('report_ready');
  let d = await json<PrProductDetail>(send('GET', `/api/pr/products/${p}?store=pawsome`));
  expect(d.assessment.report).toBeNull();
  expect(d.assessment.confidence.has.report).toBe(false);

  // A real run's report (the task's run, on a model): Risk, Differentiation and evidence confidence read it.
  db.prepare(`UPDATE pr_tasks SET run_id = 'real' WHERE id = ?`).run(t.id);
  expect(saveReport(db, t.id, body(), { runId: 'real', storeId: 'pawsome', scripted: false })).toBe("Report saved (Shortlist for testing); the owner sees it on the product's Research tab.");
  const both = await reports();
  expect(both.map((r) => [r.runId, r.demo])).toEqual([['real', false], [t.runId, true]]); // a new report never hides an older one
  d = await json<PrProductDetail>(send('GET', `/api/pr/products/${p}?store=pawsome`));
  expect(d.assessment.report).toEqual({ createdAt: both[0]!.createdAt, risks: ['Leaks if the seal fails.'], proposals: [{ kind: 'ad_angle', text: 'No more wet car seats.' }] });
  expect(d.assessment.confidence.has.report).toBe(true);
  const message = taskMessage(db, getStore(db, 'pawsome')!, { id: 'next', productId: p, instructions: 'Again.', preview: null });
  expect(message).toContain('> - Report ');
  expect(message.match(/> - Report /g)).toHaveLength(1); // the demo report isn't history
  expect(message).toContain(': shortlist; open: Real shipping time to the US?');
});

test('only the run the task started, in its store, saves; once; never citing fixtures or unknown rows; an empty list needs its reason', async () => {
  const t = await task();
  db.prepare('DELETE FROM pr_reports').run();
  const save = (over: Partial<PrReportBody>, run: { runId?: string; storeId?: string } = {}) => saveReport(db, t.id, body(over), { runId: t.runId!, storeId: 'pawsome', scripted: false, ...run });
  expect(save({}, { runId: 'another' })).toBe(`Not saved: only the run research task ${t.id} started can report on it.`);
  expect(save({}, { storeId: 'glow' })).toBe(`Not saved: there is no research task ${t.id} in this store.`);
  expect(saveReport(db, 'nope', body(), { runId: t.runId!, storeId: 'pawsome', scripted: false })).toBe('Not saved: there is no research task nope in this store.');
  const fixture = upsertListing(db, { source: 'cj', sourceRef: 'f', title: 'Fixture bowl', url: 'https://cjdropshipping.com/p/f', origin: 'fixture' }).id;
  expect(save({ evidence: [{ claim: 'c', kind: 'measured', source: `[listing:${fixture}]` }] })).toBe(`Not saved: listing:${fixture} is test fixture or demo data, not evidence. Leave it out or say what is unknown.`);
  expect(save({ supplier_offers: [{ offer: '[offer:made-up]', provenance: 'live' }] })).toBe('Not saved: offer:made-up is not one of the task\'s facts.');
  expect(save({ evidence: [{ claim: 'c', kind: 'research', source: 'CJ (fixture) listing' }] })).toBe('Not saved: "CJ (fixture) listing" is a test fixture, not evidence. Leave it out or say what is unknown.');
  expect(db.prepare('SELECT count(*) AS n FROM pr_reports').get()!.n).toBe(0);
  expect(save({})).toMatch(/^Report saved/);
  expect(save({ recommendation: 'reject' })).toBe('Report already saved for this run.');

  // The tool's own check: an empty list without its reason never reaches the store.
  const tool = APP_TOOLS.find((x) => x.name === 'save_research_report')!;
  const ctx = { ...toolEnv(db), store: getStore(db, 'pawsome')!, agent: getAgent(db, 'pawsome:product_hunter')!, emit: () => {}, runId: t.runId! };
  expect(await callTool(tool, { task: t.id, ...body({ risks: [], unknown_reasons: {} }) }, ctx)).toEqual({ output: 'Not saved: supplier_offers, risks are empty without a reason in unknown_reasons.', isError: false });
});

test('a narrowed custom role on the Product Researcher still reports (T4), and AI Agents\' Retry of the task\'s run reports for the task', async () => {
  db.prepare(`INSERT INTO agent_custom_roles (id, store_id, base_role, name, tools_json, created_at) VALUES ('scout', NULL, 'product_hunter', 'Scout', '["store_summary"]', '2026-10-28')`).run();
  const scout = await task({ type: 'scout' });
  expect(JSON.parse(String(db.prepare('SELECT tools_json FROM agent_configs WHERE id = ?').get(getRun(db, scout.runId!)!.configId!)!.tools_json))).not.toContain('save_research_report');
  expect((await reports()).map((r) => r.taskId)).toEqual([scout.id]);

  db.prepare('DELETE FROM pr_reports').run();
  db.prepare(`UPDATE agent_runs SET status = 'error', error = 'Claude had a server error.' WHERE id = ?`).run(scout.runId);
  const retried = await send('POST', `/api/conversations/${scout.conversationId}/runs/${scout.runId}/retry?store=pawsome`, { clientRequestId: randomUUID() });
  expect(retried.status).toBe(201);
  const run = (await retried.json()) as { id: string };
  await idle();
  expect(await json<PrTask>(send('GET', `/api/pr/tasks/${scout.id}?store=pawsome`))).toMatchObject({ runId: run.id, status: 'report_ready' });
  expect((await reports()).map((r) => r.runId)).toEqual([run.id]);
});

test('end to end on the scripted engine: paste, preview, store, agent, instructions, start, report, then a restart', async () => {
  const pasted = checkUrl('https://cjdropshipping.com/p/1?utm_source=x');
  if ('error' in pasted) throw new Error(pasted.error);
  const pv = await preview(db, getStore(db, 'pawsome')!, pasted, () => Promise.reject(new Error('a test never fetches')));
  expect(pv).toMatchObject({ outcome: 'existing', productId: p, listingId: listing });
  const t = await task({ productId: pv.productId, listingId: pv.listingId, url: pv.url, preview: { title: pv.title, price: null, variants: [] }, instructions: 'Supplier check only.' });
  expect(getRun(db, t.runId!)!.task).toContain("## The owner's instructions\nSupplier check only.");
  const before = await reports();
  expect(before).toHaveLength(1);

  app = createApp(db); // the app restarts: the task and its report are still there
  createRunManager({ db, env: toolEnv(db), store: () => undefined });
  expect(await json<PrTask>(send('GET', `/api/pr/tasks/${t.id}?store=pawsome`))).toMatchObject({ status: 'report_ready', runId: t.runId });
  expect(await reports()).toEqual(before);
});
