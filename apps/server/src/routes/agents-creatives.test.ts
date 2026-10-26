import { demoMedia, fakeEngine, getAgent, listCreatives, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, Creative } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { toolEnv } from './agents';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});

const input = (agentId: string): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: getStore(db, agent.storeId)!, task: 't', env: toolEnv(db) };
};
const ad = (kind: string, extra: object = {}): FakeStep => ({
  call: 'create_creative',
  input: { kind, headline: 'Glow in 3 steps', primaryText: 'The routine 40k customers swear by.', cta: 'Shop now', prompt: 'Model applying serum, soft morning light', aspect: '9:16', ...extra },
});

/** Runs the steps; the owner answers every approval request with `answer`. Returns tool outputs and requests. */
async function run(agentId: string, steps: FakeStep[], answer: ApprovalDecision = 'approve') {
  const events: AgentEvent[] = [];
  for await (const e of runAgent(input(agentId), fakeEngine(() => steps))) {
    events.push(e);
    if (e.type === 'approval_request') decide(db, e.approval.id, answer);
  }
  return {
    outputs: events.flatMap((e) => (e.type === 'tool_result' ? [e.output] : [])),
    requests: events.flatMap((e) => (e.type === 'approval_request' ? [e.approval] : [])),
  };
}

test('ad copy goes straight to the library', async () => {
  const { outputs, requests } = await run('glow:copywriter', [ad('copy', { prompt: undefined })]);
  expect(requests).toEqual([]);
  expect(outputs[0]).toMatch(/^Saved ad copy to the library/);
  const [saved] = (await (await app.request('/api/creatives?stores=glow&kind=copy')).json()) as Creative[];
  expect(saved).toMatchObject({ kind: 'copy', agentId: 'glow:copywriter', headline: 'Glow in 3 steps', credits: 0, source: 'agent' });
  expect(saved?.mediaUrl).toBeUndefined();
});

test('media asks first, then saves a demo render with its credits', async () => {
  const { outputs, requests } = await run('glow:creative_studio', [ad('video')]);
  expect(requests[0]).toMatchObject({ title: 'Generate 9:16 video ad: Glow in 3 steps', action: { kind: 'creative.generate', payload: { credits: 20 } } });
  expect(outputs[0]).toMatch(/Approved by the owner: .*Generated a demo render and saved it to the library/);
  expect(listCreatives(db, { storeIds: ['glow'] })[0]).toMatchObject({ kind: 'video', aspect: '9:16', credits: 20, source: 'demo', mediaUrl: expect.stringMatching(/^data:image\/svg\+xml/) });

  const denied = await run('glow:creative_studio', [ad('image')], 'deny');
  expect(denied.outputs[0]).toMatch(/^Denied by the owner/);
  expect(listCreatives(db, { storeIds: ['glow'] })).toHaveLength(1);
});

test("the store's daily credit cap stops generation before asking", async () => {
  updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 30 });
  await run('glow:creative_studio', [ad('video')]);
  const { outputs, requests } = await run('glow:creative_studio', [ad('video'), ad('image')]);
  expect(outputs[0]).toBe("Not generated: it needs 20 credits and 20 of today's 30-credit cap are used. Suggest it for tomorrow instead.");
  expect(requests).toHaveLength(1); // the image still fits
  expect((await run('glow:creative_studio', [ad('image', { prompt: undefined })])).outputs[0]).toBe('Not generated: media needs a prompt (the visual brief).');
});

test('demo renders escape the text they draw', () => {
  const svg = decodeURIComponent(demoMedia({ name: 'A&B', color: '#e11d48' }, { kind: 'image', aspect: '1:1', headline: '<script>x</script>' }));
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&#60;script&#62;');
  expect(svg).toContain('width="1080" height="1080"');
});

test('library routes', async () => {
  await run('glow:copywriter', [ad('copy')]);
  const [c] = listCreatives(db);
  expect((await app.request('/api/creatives?kind=gif')).status).toBe(400);
  expect((await app.request(`/api/creatives/${c!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/creatives/${c!.id}`, { method: 'DELETE' })).status).toBe(404);
});
