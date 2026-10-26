import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, Store } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { assemblePrompt, customNichePack, draftNichePackTask, fakeEngine, nicheSlug, runAgent, saveNichePack } from './index';

const store: Store = { id: 'pens', name: 'Ink & Nib', platform: 'etsy', niche: 'other', nicheDetail: 'Vintage Fountain Pens!', currency: 'USD', timezone: 'America/New_York', color: '#fff', connected: false };
const agent: Agent = { id: 'pens:copywriter', storeId: 'pens', role: 'copywriter', status: 'idle', level: 1, xp: 0 };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'frontline-niche-'));
  vi.stubEnv('FRONTLINE_DATA_DIR', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
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

test("approving save_niche_pack stores the drafted pack: the store's own niche only, with the pack on the request", async () => {
  const asked: { reason: string }[] = [];
  const approvals = {
    create: (i: { reason: string }) => (asked.push(i), { ...i, id: 'a1', status: 'pending' as const, createdAt: '' }) as never,
    decision: async () => ({ status: 'approved' }) as never,
  };
  const env = { db: { prepare: () => ({ get: () => undefined }) } as never, summary: () => ({}) as never, approvals };
  const analyst = { ...agent, id: 'pens:market_analyst', role: 'market_analyst' as const, autonomy: 'ask' as const };
  const pack = '# Vintage fountain pens niche pack\n\n## Customer\n- Collectors.';
  // Aimed at another niche: every store of that niche would load it. It lands on this store's own niche instead.
  const steps = [{ call: 'request_approval' as const, input: { title: 'Save the pack', reason: 'drafted', kind: 'save_niche_pack', payload: { slug: 'k-beauty', markdown: pack } } }];
  const events = [];
  for await (const e of runAgent({ agent: analyst, store, task: 't', env }, fakeEngine(() => steps))) events.push(e);
  expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ isError: false, output: expect.stringContaining('Niche pack saved') });
  expect(customNichePack(store.nicheDetail)).toBe(pack);
  expect(customNichePack('k-beauty')).toBe('');
  expect(asked[0]!.reason).toBe(`drafted\n\n${pack}`); // the owner approves the pack itself
  const outputs: string[] = [];
  for await (const e of runAgent({ agent: analyst, store: { ...store, niche: 'beauty' }, task: 't', env }, fakeEngine(() => steps))) if (e.type === 'tool_result') outputs.push(e.output);
  expect(outputs).toEqual(['Not sent: only a store in a custom niche saves a niche pack, and only its own.']);
});
