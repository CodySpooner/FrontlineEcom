import { playbook, saveNichePack } from '@frontline/agents';
import type { KnowledgeDoc } from '@frontline/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  process.env.FRONTLINE_DATA_DIR = mkdtempSync(join(tmpdir(), 'kb-'));
  const db = openDb();
  seedDemo(db);
  app = createApp(db);
});
afterEach(() => {
  delete process.env.FRONTLINE_DATA_DIR;
});
const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;

test('the Knowledge Base lists every layer the agents read, custom niche packs included', async () => {
  saveNichePack('vintage-fountain-pens', '# Vintage fountain pens\n\nCollectors pay for provenance.');
  const index = await get<KnowledgeDoc[]>('/api/knowledge');
  const count = (kind: string) => index.filter((d) => d.kind === kind).length;
  expect([count('playbook'), count('platform'), count('niche')]).toEqual([8, 6, 9]);
  expect(index.every((d) => d.markdown === undefined && d.chars > 0 && d.title)).toBe(true);
  expect(index.find((d) => d.key === 'other:vintage-fountain-pens')).toEqual({ kind: 'niche', key: 'other:vintage-fountain-pens', title: 'Vintage fountain pens', custom: true, chars: 55 });
  expect(index.find((d) => d.kind === 'playbook' && d.key === 'product_hunter')?.title).toBe('Product Hunter playbook');

  expect(await get<KnowledgeDoc>('/api/knowledge/playbook/ad_strategist')).toMatchObject({ markdown: playbook('ad_strategist') });
  expect((await get<KnowledgeDoc>('/api/knowledge/niche/other:vintage-fountain-pens')).markdown).toContain('provenance');
  expect((await app.request('/api/knowledge/niche/other')).status).toBe(404);
  expect((await app.request('/api/knowledge/recipes/x')).status).toBe(404);
});
