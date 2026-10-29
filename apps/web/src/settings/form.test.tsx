// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, json } from '../api/client';
import { renderApp, reply, stubApi } from '../test-utils';
import { SaveBar, ScopeSwitch } from './kit';
import { useSettingsForm } from './form';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { desktop?: unknown }).desktop;
});

type Caps = { version: number; limit: number; runs: number };
const STORES = [
  { id: 'a', name: 'Store A', color: '#f00' },
  { id: 'b', name: 'Store B', color: '#0f0' },
];

/** A section like Usage & Limits: one form per store (`?store=`), saved through the real `api()`. */
function Section() {
  const [params, setParams] = useSearchParams();
  const store = params.get('store') ?? 'a';
  const [docs, setDocs] = useState<Record<string, Caps>>({ a: { version: 1, limit: 5, runs: 3 }, b: { version: 4, limit: 9, runs: 3 } });
  const f = useSettingsForm<Caps>({
    key: `usage:${store}`,
    saved: docs[store],
    labels: { limit: 'AI usage per day' },
    save: (changes, version) => api<Caps>('/api/caps', json('PUT', { storeId: store, version, ...changes })),
    onSaved: (doc) => doc && setDocs((d) => ({ ...d, [store]: doc })),
  });
  const navigate = useNavigate();
  return (
    <>
      <ScopeSwitch variant="store" stores={STORES} value={store} onChange={(s) => setParams({ store: s ?? 'a' })} />
      <input aria-label="Limit" value={f.draft!.limit} onChange={(e) => f.set('limit', Number(e.target.value))} />
      <Link to="/settings/general">General</Link>
      <Link to="/settings/usage?store=a">Usage</Link>
      <button onClick={() => navigate(-1)}>Back</button>
      <a href="#limit">Jump to limit</a>
      <SaveBar {...f.bar} scope={store} />
      {f.dialogs}
    </>
  );
}

const where = () => screen.getByTestId('where').textContent;
const limit = () => (screen.getByLabelText('Limit') as HTMLInputElement).value;
const edit = (v: string) => fireEvent.change(screen.getByLabelText('Limit'), { target: { value: v } });
const prompt = () => screen.queryByRole('dialog', { name: 'Unsaved changes' });
const puts = (fetch: { mock: { calls: [string, RequestInit?][] } }) => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init!.body)));
const pickStore = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name: /Store A|Store B/ }));
  fireEvent.click(screen.getByRole('option', { name }));
};

describe('leaving with unsaved changes', () => {
  it('a clean form navigates freely', async () => {
    renderApp(<Section />, '/settings/usage?store=a');
    fireEvent.click(screen.getByRole('link', { name: 'General' }));
    await waitFor(() => expect(where()).toBe('/settings/general'));
    expect(prompt()).toBeNull();
  });

  it('asks on a link, on back and on a store switch; Stay keeps the page and the draft', async () => {
    const fetch = stubApi(() => ({}));
    renderApp(<Section />, '/settings/general');
    fireEvent.click(screen.getByRole('link', { name: 'Usage' })); // a history entry to go back to
    await waitFor(() => expect(where()).toBe('/settings/usage?store=a'));
    edit('8');
    for (const go of [() => fireEvent.click(screen.getByRole('link', { name: 'General' })), () => fireEvent.click(screen.getByRole('button', { name: 'Back' })), () => pickStore('Store B')]) {
      go();
      await screen.findByRole('dialog', { name: 'Unsaved changes' });
      fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
      await waitFor(() => expect(prompt()).toBeNull());
      expect(where()).toBe('/settings/usage?store=a');
      expect(limit()).toBe('8');
    }
    fireEvent.click(screen.getByRole('link', { name: 'Jump to limit' })); // a hash on the same page isn't leaving
    expect(prompt()).toBeNull();
    expect(puts(fetch)).toEqual([]);
  });

  it('Save waits for the server, then navigates', async () => {
    let answer!: () => void;
    const fetch = vi.fn((_: string, init?: RequestInit) => (init?.method === 'PUT' ? new Promise<Response>((r) => (answer = () => r(reply({ version: 2, limit: 8, runs: 3 })))) : Promise.resolve(reply({}))));
    vi.stubGlobal('fetch', fetch);
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('link', { name: 'General' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await within(dialog).findByRole('button', { name: 'Saving…' });
    expect(where()).toBe('/settings/usage?store=a');
    answer();
    await waitFor(() => expect(where()).toBe('/settings/general'));
    expect(puts(fetch)).toEqual([{ storeId: 'a', version: 1, limit: 8 }]);
  });

  it('a refused save stays, with the draft and the error', async () => {
    stubApi((_, init) => (init?.method === 'PUT' ? reply({ error: 'Must be 0–1,000', field: 'limit' }, 400) : {}));
    renderApp(<Section />, '/settings/usage?store=a');
    edit('5000');
    fireEvent.click(screen.getByRole('link', { name: 'General' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(where()).toBe('/settings/usage?store=a');
    expect(limit()).toBe('5000');
    expect(screen.getByText("Couldn't save: Must be 0–1,000")).toBeTruthy();
  });

  it('Discard drops the draft and navigates', async () => {
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('link', { name: 'General' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(where()).toBe('/settings/general'));
    expect(limit()).toBe('5');
  });

  it("store A dirty, switch to B: Discard shows B's values and sends nothing", async () => {
    const fetch = stubApi(() => ({}));
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    await pickStore('Store B');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(where()).toBe('/settings/usage?store=b'));
    expect(limit()).toBe('9');
    expect(puts(fetch)).toEqual([]);
  });

  it('store A dirty, switch to B: Save writes A, then shows B', async () => {
    const fetch = stubApi((_, init) => (init?.method === 'PUT' ? { version: 2, limit: 8, runs: 3 } : {}));
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    await pickStore('Store B');
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(where()).toBe('/settings/usage?store=b'));
    expect(puts(fetch)).toEqual([{ storeId: 'a', version: 1, limit: 8 }]);
    expect(limit()).toBe('9');
  });

  it('in a browser a dirty form vetoes reload and tab close; in the desktop app it never blocks quit', () => {
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    renderApp(<Section />, '/settings/usage?store=a');
    expect(unload()).toBe(false);
    edit('8');
    expect(unload()).toBe(true);
    cleanup();
    (window as { desktop?: unknown }).desktop = { updateReady: async () => null };
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    expect(unload()).toBe(false);
  });
});

describe('a save that went stale (409)', () => {
  const stale = (current: Caps) => reply({ error: 'Changed elsewhere', code: 'stale', current }, 409);

  it('lists the fields changed elsewhere, theirs next to mine; Reload drops mine', async () => {
    const fetch = stubApi((_, init) => (init?.method === 'PUT' ? stale({ version: 2, limit: 7, runs: 3 }) : {}));
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Changed elsewhere' });
    expect([...dialog.querySelectorAll('tbody tr')].map((r) => r.textContent)).toEqual(['AI usage per day78']);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(limit()).toBe('7'));
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(puts(fetch)).toHaveLength(1);
  });

  it('Keep mine re-applies on the new version and saves', async () => {
    const fetch = stubApi((_, init) => {
      if (init?.method !== 'PUT') return {};
      const body = JSON.parse(String(init.body)) as Caps;
      return body.version === 1 ? stale({ version: 2, limit: 7, runs: 3 }) : { ...body, version: 3, runs: 3 };
    });
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep mine' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(puts(fetch)).toEqual([
      { storeId: 'a', version: 1, limit: 8 },
      { storeId: 'a', version: 2, limit: 8 },
    ]);
    expect(limit()).toBe('8');
  });

  it("re-applies without asking when only fields I didn't touch changed", async () => {
    const fetch = stubApi((_, init) => {
      if (init?.method !== 'PUT') return {};
      const body = JSON.parse(String(init.body)) as Caps;
      return body.version === 1 ? stale({ version: 2, limit: 5, runs: 6 }) : { version: 3, limit: body.limit, runs: 6 };
    });
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Changed elsewhere' })).toBeNull();
    expect(puts(fetch)).toEqual([
      { storeId: 'a', version: 1, limit: 8 },
      { storeId: 'a', version: 2, limit: 8 },
    ]);
  });

  it('a document removed elsewhere offers only Reload', async () => {
    stubApi((_, init) => (init?.method === 'PUT' ? reply({ error: 'Gone', code: 'stale', current: null }, 409) : {}));
    renderApp(<Section />, '/settings/usage?store=a');
    edit('8');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('This was removed somewhere else while you were editing.');
    expect(screen.queryByRole('button', { name: 'Keep mine' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});
