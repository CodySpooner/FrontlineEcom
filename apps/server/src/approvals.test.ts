import { expect, test } from 'vitest';
import type { ApprovalRequest, LiveMessage } from '@frontline/shared';
import { createApp } from './app';
import { approvalsHook } from './approvals';
import { openDb } from './db';
import { seedDemo } from './demo';
import { subscribe } from './live';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db), hook: approvalsHook(db) };
};
const list = async (app: ReturnType<typeof createApp>, q = '') => (await (await app.request(`/api/approvals${q}`)).json()) as ApprovalRequest[];

test('lists pending approvals newest first, filterable by store', async () => {
  const { app } = setup();
  const pending = await list(app, '?status=pending');
  expect(pending.map((a) => a.title)).toEqual(['Pause "Spark Ads · UGC"', expect.stringMatching(/^Raise daily budget 20% \(\$\d+ → \$\d+\)$/), 'Add 3 trending products to the store']);
  expect(pending[0]).toMatchObject({ storeId: 'peak', agentId: 'peak:ad_strategist', status: 'pending', action: { kind: 'ads.pause_campaign', payload: { network: 'tiktok', campaignId: 'peak-c3' } } });
  expect((await list(app, '?stores=glow')).map((a) => a.storeId)).toEqual(['glow']);
  expect((await app.request('/api/approvals?status=maybe')).status).toBe(400);
});

test('approve / deny update the request once, broadcast it, and 404/409 otherwise', async () => {
  const { app } = setup();
  const seen: LiveMessage[] = [];
  const off = subscribe((m) => seen.push(m));
  const res = await app.request('/api/approvals/demo-appr-1/approve', { method: 'POST' });
  off();
  const a = (await res.json()) as ApprovalRequest;
  expect(a).toMatchObject({ id: 'demo-appr-1', status: 'approved' });
  expect(Date.parse(a.decidedAt!)).not.toBeNaN();
  expect(seen).toEqual([{ type: 'approval', approval: a }]);
  expect((await app.request('/api/approvals/demo-appr-1/deny', { method: 'POST' })).status).toBe(409);
  expect((await app.request('/api/approvals/nope/approve', { method: 'POST' })).status).toBe(404);
  expect((await app.request('/api/approvals/demo-appr-2/maybe', { method: 'POST' })).status).toBe(404);
  const denied = (await (await app.request('/api/approvals/demo-appr-2/deny', { method: 'POST' })).json()) as ApprovalRequest;
  expect(denied.status).toBe('denied');
  expect((await list(app, '?status=pending')).map((a) => a.id)).toEqual(['demo-appr-3']);
});

test('hook: an agent creates a request and awaits the owner decision', async () => {
  const { app, hook } = setup();
  const seen: LiveMessage[] = [];
  const off = subscribe((m) => seen.push(m));
  const req = hook.create({ storeId: 'glow', agentId: 'glow:creative_studio', runId: 'run-1', title: 'Generate 3 UGC ads', reason: '~40 Higgsfield credits', action: { kind: 'higgsfield.generate', payload: { count: 3 } } });
  expect(seen).toEqual([{ type: 'approval', approval: req }, { type: 'notification', notification: expect.objectContaining({ kind: 'approval', title: req.title, storeId: 'glow' }) }]);
  expect((await list(app, '?status=pending'))[0]).toEqual(req);

  const decided = hook.decision(req.id);
  await app.request(`/api/approvals/${req.id}/approve`, { method: 'POST' });
  off();
  expect(await decided).toMatchObject({ id: req.id, status: 'approved', runId: 'run-1' });
  // already decided → resolves immediately; unknown → rejects
  expect((await hook.decision(req.id)).status).toBe('approved');
  await expect(hook.decision('nope')).rejects.toThrow('not found');
});

test("a denial can carry the owner's reason; approvals and bad notes can't", async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const app = createApp(db);
  const post = (path: string, body?: unknown) => app.request(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
  expect((await post('/api/approvals/demo-appr-1/deny', { note: ' ' })).status).toBe(400);
  expect((await post('/api/approvals/demo-appr-1/deny', { note: 'x'.repeat(301) })).status).toBe(400);
  expect((await post('/api/approvals/demo-appr-1/deny', { note: 42 })).status).toBe(400);
  const denied = (await (await post('/api/approvals/demo-appr-1/deny', { note: '  Too expensive this month ' })).json()) as ApprovalRequest;
  expect(denied).toMatchObject({ status: 'denied', decisionNote: 'Too expensive this month' });
  expect(((await (await app.request('/api/approvals?status=denied')).json()) as ApprovalRequest[]).find((a) => a.id === 'demo-appr-1')?.decisionNote).toBe('Too expensive this month');
  const approved = (await (await post('/api/approvals/demo-appr-2/approve', { note: 'ignored' })).json()) as ApprovalRequest;
  expect(approved.status).toBe('approved');
  expect(approved.decisionNote).toBeUndefined();
  expect(((await (await post('/api/approvals/demo-appr-3/deny')).json()) as ApprovalRequest).decisionNote).toBeUndefined();
});
