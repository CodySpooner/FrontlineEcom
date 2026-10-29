// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ConfigChange, ConfigView, LiveMessage } from '@frontline/shared';
import { api, json, useLive } from '../api/client';
import { renderApp, reply, stubApi } from '../test-utils';
import { SaveBar } from './kit';
import { useSettingsForm } from './form';

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor() {
    FakeSocket.all.push(this);
  }
  close() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

type General = { version: number; baseCurrency: string };

/** A General-like section: the base currency's change row has a job (ST-16's re-rank), so the bar follows it. */
function Section() {
  useLive();
  const [doc, setDoc] = useState<General>({ version: 1, baseCurrency: 'USD' });
  const f = useSettingsForm<General>({
    key: 'general',
    saved: doc,
    labels: { baseCurrency: 'Base currency' },
    save: (set, version) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: [{ doc: 'app', version, set }] })).then((v) => ({ version: v.versions.app!, baseCurrency: String(v.values.baseCurrency), changes: v.changes })),
    onSaved: (d) => d && setDoc(d),
  });
  return (
    <section aria-label="General">
      <input aria-label="Base currency" value={f.draft!.baseCurrency} onChange={(e) => f.set('baseCurrency', e.target.value)} />
      <SaveBar {...f.bar} scope="Workspace" />
    </section>
  );
}

const change: ConfigChange = { id: 'c1', at: '2026-10-28T10:00:00.000Z', requestId: 'r1', actor: 'owner', scope: 'workspace', setting: 'baseCurrency', before: 'USD', after: 'EUR', state: 'applying' };
const say = (c: ConfigChange) => act(() => FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'config_change', change: c } satisfies LiveMessage) }));
const status = () => within(screen.getByRole('region', { name: 'General' })).getByRole('status').textContent;

it("follows the job from the live socket: applying, couldn't apply with Retry, applying, applied", async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  let row = change;
  const fetch = stubApi((url, init) => {
    if (init?.method === 'PATCH') return { values: { baseCurrency: 'EUR' }, origins: {}, versions: { app: 2 }, changes: [row] } satisfies ConfigView;
    if (url === '/api/config/changes/c1/retry' && init?.method === 'POST') return reply((row = { ...row, state: 'applying' }), 202);
    if (url.startsWith('/api/config/changes?request=r1')) return { changes: [row] };
  });
  renderApp(<Section />);
  act(() => FakeSocket.all[0]!.onopen?.());

  fireEvent.change(screen.getByLabelText('Base currency'), { target: { value: 'EUR' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(status()).toBe('Saved · applying…'));

  say((row = { ...row, state: 'failed', detail: 'FX rates unavailable' }));
  await vi.waitFor(() => expect(status()).toBe("Saved · couldn't applyCouldn't apply: FX rates unavailable")); // the cache tells React on a timer
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await vi.waitFor(() => expect(status()).toBe('Saved · applying…'));
  expect(fetch.mock.calls.filter(([url]) => url === '/api/config/changes/c1/retry')).toHaveLength(1);

  say((row = { ...row, state: 'applied' }));
  await vi.waitFor(() => expect(status()).toBe('Saved · applied'));
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('a save whose rows have no job just says Saved', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  stubApi((_url, init) => (init?.method === 'PATCH' ? ({ values: { baseCurrency: 'EUR' }, origins: {}, versions: { app: 2 }, changes: [{ ...change, state: 'saved' }] } satisfies ConfigView) : undefined));
  renderApp(<Section />);
  fireEvent.change(screen.getByLabelText('Base currency'), { target: { value: 'EUR' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await vi.waitFor(() => expect(status()).toBe('Saved'));
});
