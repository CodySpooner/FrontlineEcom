import { fakeEngine, getAgent, runAgent, type FakeStep } from '@frontline/agents';
import type { AgentEvent, FlowDraft } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
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
});
async function run(steps: FakeStep[]) {
  const agent = getAgent(db, 'glow:email_sms')!;
  const out: string[] = [];
  for await (const e of runAgent({ agent, store: getStore(db, 'glow')!, task: 't', env: toolEnv(db) }, fakeEngine(() => steps)) as AsyncIterable<AgentEvent>) {
    if (e.type === 'tool_result') out.push(e.output);
  }
  return out;
}
const flow = (extra: object = {}): FakeStep => ({
  call: 'draft_flow',
  input: {
    name: 'Checkout abandonment',
    trigger: 'Checkout started, no order within 1 hour; exclude buyers in the last 30 days',
    messages: [
      { delayHours: 1, channel: 'email', subject: 'Your serum is waiting', preview: 'Still deciding?', body: 'Reminder with the product, 3 reviews, shipping times.' },
      { delayHours: 24, channel: 'sms', body: 'Glow Haus: your cart is saved for 24h. Reply STOP to opt out.', offer: '10% code GLOW10' },
    ],
    notes: '412 abandoned checkouts in 30d, AOV $54, no recovery flow live; recover 4-8% ≈ $900-1,800/month.',
    ...extra,
  },
});

test('Email & SMS saves flows to the library; a redraft replaces the old one', async () => {
  const out = await run([
    flow(),
    flow({ notes: 'Second pass: 3 steps would over-mail a 1,050-checkout list; keep 2.' }),
    flow({ name: 'Welcome', messages: [{ delayHours: 0, channel: 'email', body: 'Welcome and brand story.' }] }),
  ]);
  expect(out[0]).toBe('Saved "Checkout abandonment" (2 steps) to the flow library. The owner sets it up in their email/SMS tool.');
  expect(out[2]).toBe('Every email step needs a subject.');

  const flows = (await (await app.request('/api/flow-drafts?stores=glow')).json()) as FlowDraft[];
  expect(flows).toHaveLength(1);
  expect(flows[0]).toMatchObject({ storeId: 'glow', agentId: 'glow:email_sms', name: 'Checkout abandonment', notes: expect.stringMatching(/^Second pass/) });
  expect(flows[0]!.messages[1]).toEqual({ delayHours: 24, channel: 'sms', body: 'Glow Haus: your cart is saved for 24h. Reply STOP to opt out.', offer: '10% code GLOW10' });
  expect(await (await app.request('/api/flow-drafts?stores=pawsome')).json()).toEqual([]);

  expect((await app.request(`/api/flow-drafts/${flows[0]!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/flow-drafts/${flows[0]!.id}`, { method: 'DELETE' })).status).toBe(404);
});

test('list_flows shows what is already in the library', async () => {
  expect(await run([{ call: 'list_flows' }])).toEqual(['(none)']);
  const [, , list] = await run([flow(), flow({ name: 'Welcome series' }), { call: 'list_flows' }]);
  const [header, ...rows] = list!.split('\n');
  expect(header).toBe('name,drafted,trigger,steps,channels,last_step_hours');
  expect(rows.map((r) => [r.split(',')[0], r.split(',').slice(-3).join(',')])).toEqual([
    ['Welcome series', '2,email+sms,24'],
    ['Checkout abandonment', '2,email+sms,24'],
  ]);
});
