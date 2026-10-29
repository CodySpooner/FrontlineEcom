// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ConfigView, ConfigWrite } from '@frontline/shared';
import { App } from '../../App';
import { renderApp, reply } from '../../test-utils';
import { reducedMotion } from '../motion';

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
});
afterAll(() => vi.unstubAllGlobals());

test('Always reduce sets <html data-motion> only once the server confirms; a refusal leaves it; Follow Windows clears it', async () => {
  let view: ConfigView = { values: { 'appearance.motion': 'system' }, origins: {}, versions: { personal: 0 } };
  let release = () => {};
  let refuse = false;
  const patches: ConfigWrite[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/config' && init?.method === 'PATCH') {
        const w = JSON.parse(String(init.body)) as ConfigWrite;
        patches.push(w);
        await new Promise<void>((r) => (release = r)); // the server answers when the test says
        if (refuse) return reply({ error: 'This was saved somewhere else while you were editing.', code: 'stale' }, 409);
        const d = w.documents[0]!;
        view = { ...view, values: { ...view.values, ...d.set }, versions: { personal: d.version + 1 } };
        return reply({ ...view, changes: [] });
      }
      return reply(url === '/api/config' ? view : url === '/api/health' ? { ok: true, uptimeSec: 1, version: 'dev', connectors: [] } : []);
    }),
  );
  renderApp(<App />, '/settings/appearance');
  fireEvent.click(await screen.findByRole('radio', { name: 'Always reduce' }));
  await vi.waitFor(() => expect(patches).toEqual([{ documents: [{ doc: 'personal', version: 0, set: { 'appearance.motion': 'reduce' } }] }]));
  expect(await screen.findByText('Saving…')).toBeTruthy();
  expect(document.documentElement.dataset.motion).toBeUndefined(); // not before the server says so
  release();
  await vi.waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduce'));
  expect(await screen.findByText('Saved')).toBeTruthy();

  // Refused (changed elsewhere): it stays as the server has it, and says why.
  refuse = true;
  fireEvent.click(screen.getByRole('radio', { name: 'Follow Windows' }));
  await vi.waitFor(() => expect(patches).toHaveLength(2));
  release();
  expect(await screen.findByText('This was saved somewhere else while you were editing.')).toBeTruthy();
  expect(document.documentElement.dataset.motion).toBe('reduce');

  refuse = false;
  fireEvent.click(screen.getByRole('radio', { name: 'Follow Windows' }));
  await vi.waitFor(() => expect(patches.at(-1)).toEqual({ documents: [{ doc: 'personal', version: 1, set: { 'appearance.motion': 'system' } }] }));
  release();
  await vi.waitFor(() => expect(document.documentElement.dataset.motion).toBeUndefined());

  // Saved as Always reduce, it's back on <html> at the next start, from the server.
  view = { ...view, values: { 'appearance.motion': 'reduce' } };
  cleanup();
  renderApp(<App />, '/');
  await vi.waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduce'));
});

test("index.css has a data-motion copy of every prefers-reduced-motion rule", () => {
  const css = readFileSync('apps/web/src/index.css', 'utf8');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
  expect(blocks.length).toBeGreaterThan(0);
  for (const block of blocks) {
    for (const [, selectors, body] of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const copy = `${selectors!.split(',').map((s) => `[data-motion='reduce'] ${s.trim()}`).join(', ')} { ${norm(body!)} }`;
      expect(norm(css), copy).toContain(copy);
    }
  }
});

test('the AI Ecosystem renderer reads Always reduce like the media query, every frame', () => {
  const media = { matches: false };
  const reduced = reducedMotion(media);
  expect(reduced.matches).toBe(false);
  document.documentElement.dataset.motion = 'reduce';
  expect(reduced.matches).toBe(true);
  delete document.documentElement.dataset.motion;
  expect(reduced.matches).toBe(false);
  media.matches = true; // Windows' setting
  expect(reduced.matches).toBe(true);
  expect(readFileSync('apps/web/src/ecosystem/renderer.ts', 'utf8')).toContain("const reduced = reducedMotion(matchMedia('(prefers-reduced-motion: reduce)'));");
});
