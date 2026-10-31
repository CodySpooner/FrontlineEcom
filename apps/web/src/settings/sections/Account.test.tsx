// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Settings as SettingsT } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, stubApi } from '../../test-utils';
import { SECTIONS } from '../Layout';

afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const initial: SettingsT = { profile: { name: 'Cody', plan: 'Pro Plan' }, notifications: { approvals: true, agentDone: true, errors: true, digest: true, researchAlerts: true }, baseCurrency: 'USD', dataDir: 'C:/data', version: 4 };
/** A server that keeps what it's sent, as /api/settings does. */
const server = () => {
  let saved = initial;
  const fetch = stubApi((url, init) => {
    if (url === '/api/settings' && init?.method === 'PATCH') {
      const { version, profile } = JSON.parse(String(init.body)) as { version: number; profile: { name: string } };
      return (saved = { ...saved, profile: { ...saved.profile, name: profile.name.trim() }, version: version + 1 });
    }
    if (url === '/api/settings') return saved;
    if (url === '/api/config') return { values: {}, origins: {}, versions: { app: 1 } };
    if (url === '/api/health') return { ok: true, uptimeSec: 1, version: 'dev', connectors: [] };
    if (url.startsWith('/api/config/changes?') || url === '/api/config/changes') return { changes: [] }; // Change History (ST-32)
  });
  return { fetch, saved: () => saved };
};

test('a rename persists across a refetch and shows on the chip', async () => {
  const s = server();
  renderApp(<Settings />, '/settings/account');
  expect(await screen.findByRole('link', { name: /Cody/ })).toBeTruthy();
  fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Sam ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('link', { name: /Sam/ })).toBeTruthy();
  expect(s.fetch.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([u, i]) => [u, JSON.parse(String(i!.body))])).toEqual([['/api/settings', { version: 4, profile: { name: 'Sam ' } }]]);
  expect(s.saved()).toMatchObject({ profile: { name: 'Sam' }, version: 5 });

  // A fresh load (a new window) reads it back from the server.
  cleanup();
  renderApp(<Settings />, '/settings/account');
  expect(((await screen.findByLabelText('Display name')) as HTMLInputElement).value).toBe('Sam');
  expect(screen.getByRole('link', { name: /Sam/ })).toBeTruthy();
});

test('no rendered page says "Pro Plan": no settings section, no chip, and no web source reads the plan', async () => {
  server();
  for (const s of SECTIONS) {
    renderApp(<Settings />, `/settings/${s.slug}`);
    await screen.findByRole('link', { name: /Cody/ });
    expect(document.body.textContent, s.slug).not.toContain('Pro Plan');
    expect(screen.getByRole('link', { name: /Cody/ }).textContent).toBe('CCodyOwner');
    cleanup();
  }
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const readers = files('apps/web/src').filter((f) => /Pro Plan|profile\??\.plan\b/.test(readFileSync(f, 'utf8')));
  expect(readers).toEqual([]);
});
