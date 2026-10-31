// ST-30 (decision 14): the approval map covers every approval kind with real tools, nothing the owner turns on lets a
// live store edit, a publish or a connected tool's write skip the owner, and the schedules the overview links to.
import { APP_TOOLS, getAgent, requestApproval, updateAgent } from '@frontline/agents';
import { APPROVAL_KINDS, APPROVAL_MAP, type ApprovalRequest, type AutomationRule } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { toolEnv } from '../routes/agents';
import { updateCaps } from '../settings';
import { getStore } from '../stores';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 26, 8, 0, 30));
  db = openDb();
  seedDemo(db, '2026-10-26');
  app = createApp(db);
});
afterEach(() => vi.useRealTimers());

const send = async <T>(method: string, path: string, body?: unknown) => {
  const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: (await r.json()) as T };
};

test('every approval kind is in exactly one row of the approval map, and every tool it names is a real tool', () => {
  const rows = (kind: string) => APPROVAL_MAP.filter((r) => r.kinds.includes(kind)).map((r) => r.category);
  expect(Object.keys(APPROVAL_KINDS).filter((k) => rows(k).length !== 1)).toEqual([]);
  expect(APPROVAL_MAP.flatMap((r) => r.kinds).filter((k) => !(k in APPROVAL_KINDS))).toEqual([]);
  const tools = new Set(APP_TOOLS.map((t) => t.name as string));
  expect(APPROVAL_MAP.flatMap((r) => r.tools).filter((t) => !tools.has(t))).toEqual([]);
  // Nothing an agent has deletes the owner's data or writes to customers: those rows must keep saying so.
  expect([...tools].filter((t) => /^(delete|remove|send|email|sms|message|refund)_/.test(t))).toEqual([]);
});

test('with autopilot, self-directed research and a "Run on its own" rule all on, price, product, page, theme and tool writes still ask you', async () => {
  db.prepare(`UPDATE approvals SET status = 'denied' WHERE status = 'pending'`).run(); // the demo's own requests
  updateAgent(db, 'glow:store_developer', { autonomy: 'autopilot' });
  const asked = ['store.set_price', 'store.add_products', 'store.publish_page', 'store.publish_theme', 'tool_use'];
  // Rules for kinds autopilot can't take, as an old database could hold them, plus the real one.
  updateCaps(db, 'glow', { adSpendChangePerDay: 1e6, autopilot: Object.fromEntries([...asked, 'ads.set_budget'].map((k) => [k, { enabled: true, maxUsdPerDay: 1e6 }])) });
  const { version } = (await send<{ version: number }>('GET', '/api/kb/controls?ws=glow')).body;
  expect((await send('PUT', '/api/kb/controls?ws=glow', { autonomous: true, roles: { market_analyst: [] }, approval: false, version })).status).toBe(200);
  expect((await send<AutomationRule>('POST', '/api/automations', { storeId: 'glow', name: 'Nightly tidy', approval: 'auto', trigger: { type: 'schedule', cron: '0 2 * * *' }, action: { type: 'agent_task', agentId: 'glow:store_developer', task: 'Tidy the catalog' } })).status).toBe(201);

  const seen: ApprovalRequest[] = [];
  const ctx = {
    ...toolEnv(db),
    store: getStore(db, 'glow')!,
    agent: getAgent(db, 'glow:store_developer')!,
    emit: (e: { type: string; approval?: ApprovalRequest }) => {
      if (e.type !== 'approval_request' || !e.approval) return;
      seen.push(e.approval);
      if (e.approval.status === 'pending') decide(db, e.approval.id, 'deny');
    },
  };
  for (const kind of [...asked, 'ads.set_budget']) {
    await requestApproval(ctx as never, { title: `Do ${kind}`, reason: 'r', action: { kind, payload: {}, amountUsd: 5 }, autopilot: true });
  }
  expect(seen.map((a) => [a.action.kind, a.status, a.action.auto ?? false])).toEqual([
    ...asked.map((k) => [k, 'pending', false]),
    ['ads.set_budget', 'approved', true], // the setup really is autopilot: the one kind it may take goes through
  ]);
});

test('editing a schedule keeps its rule id; a monthly rule has no next run within the 8-day look-ahead', async () => {
  const made = (await send<AutomationRule>('POST', '/api/automations', { storeId: 'glow', name: 'Brief', trigger: { type: 'schedule', cron: '0 9 * * *' }, action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Write the brief' } })).body;
  const edited = await send<AutomationRule>('PATCH', `/api/automations/${made.id}`, { trigger: { type: 'schedule', cron: '0 9 15 * *' }, version: made.version });
  expect(edited.status).toBe(200);
  const mine = (await send<AutomationRule[]>('GET', '/api/automations?stores=glow')).body.filter((r) => r.name === 'Brief');
  expect(mine.map((r) => [r.id, r.trigger])).toEqual([[made.id, { type: 'schedule', cron: '0 9 15 * *' }]]);
  expect(mine[0]!.nextRunAt).toBeUndefined(); // the 15th is 20 days off: the overview says "More than 8 days away"
});

test('adding a research schedule that already exists is refused; another topic or schedule is added', async () => {
  const research = (task: string, cron = '0 9 * * 1') =>
    send<{ error?: string }>('POST', '/api/automations', { storeId: 'glow', name: task, trigger: { type: 'schedule', cron }, action: { type: 'kb_research', agentId: 'glow:market_analyst', task }, approval: 'auto', maxRunsPerDay: 1 });
  expect((await research('Serum pricing in the UK')).status).toBe(201);
  expect(await research('Serum pricing in the UK')).toEqual({ status: 400, body: { error: 'This research is already on that schedule.', field: 'action' } });
  expect((await research('Serum pricing in the UK', '0 9 1 * *')).status).toBe(201);
  expect((await research('Serum pricing in France')).status).toBe(201);
});
