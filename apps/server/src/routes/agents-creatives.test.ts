import { chargeCredits, creditsToday, demoMedia, wrap, fakeEngine, getAgent, listCreatives, runAgent, type FakeStep, type RunInput, type ToolEnv } from '@frontline/agents';
import type { AgentEvent, ApprovalDecision, Creative } from '@frontline/shared';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { updateCaps } from '../settings';
import { getStore } from '../stores';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolEnv } from './agents';
import { creativeRoutes, higgsfieldGenerate } from './agents-creatives';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
  generateMedia = undefined;
});

let generateMedia: ToolEnv['generateMedia'];
const input = (agentId: string): RunInput => {
  const agent = getAgent(db, agentId)!;
  return { agent, store: getStore(db, agent.storeId)!, task: 't', env: { ...toolEnv(db), ...(generateMedia ? { generateMedia } : {}) } };
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
  expect(outputs[0]).toMatch(/Approved by the owner: .*Higgsfield isn't connected, so this is a demo render, saved to the library/);
  expect(listCreatives(db, { storeIds: ['glow'] })[0]).toMatchObject({ kind: 'video', aspect: '9:16', credits: 20, source: 'demo', mediaUrl: expect.stringMatching(/^data:image\/svg\+xml/) });

  const denied = await run('glow:creative_studio', [ad('image')], 'deny');
  expect(denied.outputs[0]).toMatch(/^Denied by the owner/);
  expect(listCreatives(db, { storeIds: ['glow'] })).toHaveLength(1);
});

test('a live store without Higgsfield gets no placeholder render for its credits', async () => {
  db.prepare(`UPDATE stores SET connected = 1 WHERE id = 'glow'`).run();
  const { outputs, requests } = await run('glow:creative_studio', [ad('image'), ad('copy', { prompt: undefined })]);
  expect(outputs[0]).toBe(
    'Not generated: Higgsfield isn\'t connected, so the app could only make a placeholder, not an ad you can run. Save the copy with kind "copy" and put the visual brief in your answer; the owner connects Higgsfield in Integrations.',
  );
  expect(outputs[1]).toMatch(/^Saved ad copy to the library/);
  expect(requests).toEqual([]);
  expect(creditsToday(db, 'glow')).toBe(0);
});

test("the store's daily credit cap stops generation before asking", async () => {
  updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 30 });
  await run('glow:creative_studio', [ad('video')]);
  const { outputs, requests } = await run('glow:creative_studio', [ad('video'), ad('image')]);
  expect(outputs[0]).toBe("Not generated: it needs 20 credits and 20 of today's 30-credit cap are used. Suggest it for tomorrow instead.");
  expect(requests).toHaveLength(1); // the image still fits
  expect((await run('glow:creative_studio', [ad('image', { prompt: undefined })])).outputs[0]).toBe('Not generated: media needs a prompt (the visual brief).');
});

test("credits stay spent when a creative is deleted or its render fails, and asked renders hold the cap's room", async () => {
  updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 50 });
  await run('glow:creative_studio', [ad('video')]);
  const [video] = listCreatives(db, { storeIds: ['glow'] });
  expect((await app.request(`/api/creatives/${video!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect(creditsToday(db, 'glow')).toBe(20);

  generateMedia = async () => {
    throw new Error('Higgsfield render still running after 10 min (request r-9)');
  };
  expect((await run('glow:creative_studio', [ad('video')])).outputs[0]).toMatch(/its 20 credits still count toward today's cap/);
  expect(creditsToday(db, 'glow')).toBe(40);

  db.prepare(`INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, status, created_at) VALUES ('w', 'glow', 'glow:copywriter', 't', 'r', ?, 'pending', ?)`).run(
    JSON.stringify({ kind: 'creative.generate', payload: { credits: 9 } }), new Date().toISOString(),
  );
  const asked = await run('glow:creative_studio', [ad('image')]); // 40 + 2 fits, but not with the 9 already asked
  expect(asked.outputs[0]).toBe("Not generated: it needs 2 credits and 40 of today's 50-credit cap are used (9 more asked, waiting on the owner). Suggest it for tomorrow instead.");
});

test('a render approved after the cap filled up meanwhile is not generated', async () => {
  updateCaps(db, 'glow', { higgsfieldCreditsPerDay: 30 });
  const outputs: string[] = [];
  for await (const e of runAgent(input('glow:creative_studio'), fakeEngine(() => [ad('video')]))) {
    if (e.type === 'approval_request') chargeCredits(db, 'glow', 20), decide(db, e.approval.id, 'approve'); // another render took the room
    if (e.type === 'tool_result') outputs.push(e.output);
  }
  expect(outputs[0]).toMatch(/but not generated: other renders used 20 of today's 30-credit cap meanwhile/);
  expect(creditsToday(db, 'glow')).toBe(20);
  expect(listCreatives(db, { storeIds: ['glow'] })).toEqual([]);
});

test('demo renders escape the text they draw', () => {
  const svg = decodeURIComponent(demoMedia({ name: 'A&B', color: '#e11d48' }, { kind: 'image', aspect: '1:1', headline: '<script>x</script>' }));
  expect(svg).not.toContain('<script>');
  expect(svg).toContain('&#60;script&#62;');
  expect(svg).toContain('width="1080" height="1080"');
});

test('demo renders wrap long headlines instead of clipping them', () => {
  expect(wrap('My dog finally drinks on the road', 20)).toEqual(['My dog finally', 'drinks on the road']);
  expect(wrap('one two three four five six seven', 9, 2)).toEqual(['one two', 'three fo…']);
  const svg = decodeURIComponent(demoMedia({ name: 'Pawsome', color: '#22c55e' }, { kind: 'video', aspect: '9:16', headline: 'My dog finally drinks on the road', cta: 'Shop now' }));
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]!);
  expect(lines).toEqual(['My dog finally', 'drinks on the road']);
});

test('library routes', async () => {
  await run('glow:copywriter', [ad('copy')]);
  const [c] = listCreatives(db);
  expect((await app.request('/api/creatives?kind=gif')).status).toBe(400);
  expect((await app.request(`/api/creatives/${c!.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/creatives/${c!.id}`, { method: 'DELETE' })).status).toBe(404);
});

test('with Higgsfield connected the render is saved as a higgsfield creative; a failed render saves nothing', async () => {
  generateMedia = async (req) => `/api/creatives/media/req-1.${req.kind === 'image' ? 'jpg' : 'mp4'}`;
  expect((await run('glow:creative_studio', [ad('image')])).outputs[0]).toMatch(/Rendered on Higgsfield and saved to the library/);
  expect(listCreatives(db, { storeIds: ['glow'] })[0]).toMatchObject({ kind: 'image', aspect: '9:16', source: 'higgsfield', mediaUrl: '/api/creatives/media/req-1.jpg', credits: 2 });
  // Its video models take no aspect: the video isn't labelled 9:16, and the agent is told to check it.
  expect((await run('glow:creative_studio', [ad('video')])).outputs[0]).toMatch(/saved to the library \([\w-]+\)\. Higgsfield's video models take no aspect ratio, so it's in the model's own frame, not necessarily 9:16/);
  expect(listCreatives(db, { storeIds: ['glow'], kind: 'video' })[0]).toMatchObject({ source: 'higgsfield', mediaUrl: '/api/creatives/media/req-1.mp4' });
  expect(listCreatives(db, { storeIds: ['glow'], kind: 'video' })[0]!.aspect).toBeUndefined();

  generateMedia = async () => {
    throw new Error('Higgsfield render nsfw');
  };
  expect((await run('glow:creative_studio', [ad('video')])).outputs[0]).toMatch(/, but generation failed: Higgsfield render nsfw\. Nothing was saved/);
  expect(listCreatives(db, { storeIds: ['glow'] })).toHaveLength(2);
});

test('higgsfieldGenerate submits, polls, downloads the output and serves it locally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-'));
  const calls: [string, RequestInit | undefined][] = [];
  const statuses = ['queued', 'in_progress', 'completed'];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url === 'https://api.higgsfield.ai/higgsfield-ai/soul/standard') return Response.json({ request_id: 'r-42', status_url: 'https://api.higgsfield.ai/requests/r-42/status' });
    if (url.endsWith('/requests/r-42/status')) {
      const status = statuses.shift();
      return Response.json({ request_id: 'r-42', status, ...(status === 'completed' ? { images: [{ url: 'https://cdn.example.com/out.png' }] } : {}) });
    }
    if (url === 'https://cdn.example.com/out.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;

  const url = await higgsfieldGenerate({ keyId: 'kid', keySecret: 'ksec' }, { kind: 'image', aspect: '4:5', prompt: 'serum on marble' }, dir, { fetch: fetchFn, pollMs: 1 });
  expect(url).toBe('/api/creatives/media/r-42.png');
  expect(calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify({ prompt: 'serum on marble', aspect_ratio: '4:5' }), headers: { Authorization: 'Key kid:ksec' } });
  expect(calls.filter(([u]) => u.includes('/status'))).toHaveLength(3);

  const routes = creativeRoutes(db, () => dir);
  const res = await routes.request(url);
  expect(res.headers.get('content-type')).toBe('image/png');
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  expect((await routes.request('/api/creatives/media/..%2Fsecret.key')).status).toBe(404);

  const failing = (async (u: string) =>
    u.includes('/status') ? Response.json({ request_id: 'r-9', status: 'failed', error: 'bad prompt' }) : Response.json({ request_id: 'r-9' })) as typeof fetch;
  await expect(higgsfieldGenerate({ keyId: 'k', keySecret: 's' }, { kind: 'video', aspect: '9:16', prompt: 'x' }, dir, { fetch: failing })).rejects.toThrow('Higgsfield render failed: bad prompt');

  // A download that stalls fails on its own instead of holding the run.
  const stalled = (async (u: string, init?: RequestInit) =>
    u.includes('/status') ? Response.json({ request_id: 'r-7', status: 'completed', images: [{ url: 'https://cdn.example.com/slow.png' }] })
    : u.includes('slow') ? new Promise((_, no) => init!.signal!.addEventListener('abort', () => no(init!.signal!.reason)))
    : Response.json({ request_id: 'r-7' })) as typeof fetch;
  await expect(higgsfieldGenerate({ keyId: 'k', keySecret: 's' }, { kind: 'image', aspect: '1:1', prompt: 'x' }, dir, { fetch: stalled, callMs: 20 })).rejects.toThrow(/timeout/i);
});

test('deleting a creative deletes its rendered file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hf-'));
  writeFileSync(join(dir, 'r-1.mp4'), 'video');
  db.prepare(`INSERT INTO creatives (id, store_id, agent_id, kind, aspect, prompt, headline, primary_text, media_url, credits, source, created_at)
    VALUES ('c-1', 'glow', 'glow:creative_studio', 'video', '9:16', 'p', 'h', 't', '/api/creatives/media/r-1.mp4', 40, 'higgsfield', '2026-10-26T00:00:00Z')`).run();
  const routes = creativeRoutes(db, () => dir);
  expect((await routes.request('/api/creatives/c-1', { method: 'DELETE' })).status).toBe(204);
  expect(existsSync(join(dir, 'r-1.mp4'))).toBe(false);
  expect((await routes.request('/api/creatives/c-1', { method: 'DELETE' })).status).toBe(404);
});

test('the squad reads the library back without the media payloads', async () => {
  await run('glow:creative_studio', [ad('image'), ad('copy', { prompt: undefined, headline: 'Skin that glows by 8am' })]);
  const { outputs } = await run('glow:ad_strategist', [{ call: 'list_creatives' }, { call: 'list_creatives', input: { kind: 'copy' } }]);
  const rows = outputs[0]!.split('\n');
  expect(rows[0]).toBe('id,created,kind,aspect,headline,primary_text,cta,media');
  expect(rows.slice(1).map((r) => r.split(',').slice(2, 5).concat(r.split(',').at(-1)!))).toEqual([
    ['copy', '', 'Skin that glows by 8am', 'none'],
    ['image', '9:16', 'Glow in 3 steps', 'demo'],
  ]);
  expect(outputs[0]).not.toContain('data:');
  expect(outputs[1]!.split('\n')).toHaveLength(2);
});
