import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, Store } from '@frontline/shared';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { assemblePrompt, customNichePack, draftNichePackTask, fakeEngine, nicheSlug, runAgent, saveNichePack } from './index';

const store: Store = { id: 'pens', name: 'Ink & Nib', platform: 'etsy', niche: 'other', nicheDetail: 'Vintage Fountain Pens!', currency: 'USD', timezone: 'America/New_York', color: '#fff', connected: false };
const agent: Agent = { id: 'pens:copywriter', storeId: 'pens', role: 'copywriter', status: 'idle', level: 1, xp: 0 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'frontline-niche-'));
  process.env.FRONTLINE_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.FRONTLINE_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

test('slugs are file-safe', () => {
  expect(nicheSlug('Vintage Fountain Pens!')).toBe('vintage-fountain-pens');
  expect(nicheSlug('  K-Beauty / Skincare  ')).toBe('k-beauty-skincare');
});

test('the draft task carries the template and the save instructions', () => {
  const task = draftNichePackTask(store);
  for (const section of ['## Customer', '## Compliance and claims', '## Seasonality', '## Red flags']) expect(task).toContain(section);
  expect(task).toContain('"slug": "vintage-fountain-pens"');
  expect(task).toContain('save_niche_pack');
});

test('a saved custom pack reaches the prompt of stores in that niche', () => {
  expect(customNichePack(store.nicheDetail)).toBe('');
  const pack = '# Vintage fountain pens niche pack\n\n## Customer\n- Collectors and writers.';
  saveNichePack('vintage-fountain-pens', pack);
  expect(customNichePack(store.nicheDetail)).toBe(pack);
  expect(assemblePrompt({ agent, store, today: '2026-10-26' })).toContain(pack);
});

test('approving save_niche_pack stores the drafted pack', async () => {
  const approvals = {
    create: (i: object) => ({ ...i, id: 'a1', status: 'pending' as const, createdAt: '' }) as never,
    decision: async () => ({ status: 'approved' }) as never,
  };
  const env = { db: { prepare: () => ({ get: () => undefined }) } as never, summary: () => ({}) as never, approvals };
  const analyst = { ...agent, id: 'pens:market_analyst', role: 'market_analyst' as const, autonomy: 'ask' as const };
  const pack = '# Vintage fountain pens niche pack\n\n## Customer\n- Collectors.';
  const steps = [{ call: 'request_approval' as const, input: { title: 'Save the pack', reason: 'drafted', kind: 'save_niche_pack', payload: { slug: 'vintage-fountain-pens', markdown: pack } } }];
  const events = [];
  for await (const e of runAgent({ agent: analyst, store, task: 't', env }, fakeEngine(() => steps))) events.push(e);
  expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ isError: false, output: expect.stringContaining('Niche pack saved') });
  expect(customNichePack(store.nicheDetail)).toBe(pack);
});
