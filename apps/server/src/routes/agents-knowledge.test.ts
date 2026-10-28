import { playbook, saveNichePack } from '@frontline/agents';
import type { KnowledgeDoc } from '@frontline/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  vi.stubEnv('FRONTLINE_DATA_DIR', mkdtempSync(join(tmpdir(), 'kb-')));
  const db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;

test('the Knowledge Base lists every layer the agents read, custom niche packs included', async () => {
  saveNichePack('vintage-fountain-pens', '# Vintage fountain pens\n\nCollectors pay for provenance.');
  const index = await get<KnowledgeDoc[]>('/api/knowledge');
  const count = (kind: string) => index.filter((d) => d.kind === kind).length;
  expect([count('playbook'), count('platform'), count('niche')]).toEqual([8, 6, 9]);
  expect(index.every((d) => d.markdown === undefined && d.chars > 0 && d.title)).toBe(true);
  expect(index.find((d) => d.key === 'other:vintage-fountain-pens')).toEqual({ kind: 'niche', key: 'other:vintage-fountain-pens', title: 'Vintage fountain pens', custom: true, chars: 55 });
  expect(index.find((d) => d.kind === 'playbook' && d.key === 'product_hunter')?.title).toBe('Product Researcher playbook');

  expect(await get<KnowledgeDoc>('/api/knowledge/playbook/ad_strategist')).toMatchObject({ markdown: playbook('ad_strategist') });
  expect((await get<KnowledgeDoc>('/api/knowledge/niche/other:vintage-fountain-pens')).markdown).toContain('provenance');
  expect((await app.request('/api/knowledge/niche/other')).status).toBe(404);
  expect((await app.request('/api/knowledge/recipes/x')).status).toBe(404);
}, 15_000); // like the test below: timed out at 5 s under the full suite's load

test('the owner edits a layer: agents read the edit until it is reset to the shipped one', async () => {
  saveNichePack('vintage-fountain-pens', '# Vintage fountain pens\n\nCollectors pay for provenance.');
  const shipped = playbook('copywriter');
  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

  const saved = await (await send('PUT', '/api/knowledge/playbook/copywriter', { markdown: '# Copywriter playbook\n\nNo exclamation marks.\n' })).json();
  expect(saved).toMatchObject({ kind: 'playbook', key: 'copywriter', edited: true, markdown: '# Copywriter playbook\n\nNo exclamation marks.' });
  expect(playbook('copywriter')).toContain('No exclamation marks.');
  expect((await get<KnowledgeDoc[]>('/api/knowledge')).find((d) => d.key === 'copywriter')?.edited).toBe(true);

  expect(await (await send('DELETE', '/api/knowledge/playbook/copywriter')).json()).not.toHaveProperty('edited');
  expect(playbook('copywriter')).toBe(shipped);

  const pack = (await (await send('PUT', '/api/knowledge/niche/other:vintage-fountain-pens', { markdown: '# Vintage fountain pens\n\nNibs matter.' })).json()) as KnowledgeDoc;
  expect(pack.markdown).toContain('Nibs matter.');
  expect((await send('DELETE', '/api/knowledge/niche/other:vintage-fountain-pens')).status).toBe(400);
  expect((await send('PUT', '/api/knowledge/playbook/../../etc', { markdown: '# x' })).status).toBe(404);
  expect((await send('PUT', '/api/knowledge/niche/pet', { markdown: ' ' })).status).toBe(400);
}, 15_000); // file writes: 1 s alone, timed out at 5 s once under the full suite's load
