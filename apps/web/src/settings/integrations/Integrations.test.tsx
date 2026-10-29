// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Integration, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../../test-utils';
import { ClaudeCard, ConnectForm, Connection, Integrations } from './Integrations';

const saved: Integration = { id: 'i1', kind: 'cj', status: 'connected', settings: { email: 'ops@shop.test' }, secretsSet: ['apiKey'], updatedAt: '2026-10-26T08:00:00Z' };
const sent = (fetch: ReturnType<typeof stubApi>) => JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'PUT')?.[1]?.body));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('connect form', () => {
  it('leaves a saved secret out when its field is blank, so the server keeps it', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PUT' ? saved : undefined));
    const onDone = vi.fn();
    renderApp(<ConnectForm kind="cj" current={saved} onDone={onDone} />);

    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.required).toBe(false);
    expect(key.placeholder).toBe('Saved. Leave blank to keep it.');
    fireEvent.change(screen.getByLabelText('Account email (optional)'), { target: { value: ' buyer@shop.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent(fetch)).toEqual({ kind: 'cj', values: { email: 'buyer@shop.test' }, version: saved.version ?? 0 });
  });

  it("warns that Amazon on a Shopify store that imports its Amazon orders would count them twice", () => {
    stubApi(() => undefined);
    const store = (platform: Store['platform']) => ({ id: 's1', name: 'Peak Fit', platform, niche: 'fitness', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true }) as Store;
    renderApp(<ConnectForm kind="amazon" store={store('shopify')} onDone={() => {}} />);
    expect(screen.getByText(/If Peak Fit's Shopify already imports its Amazon orders \(Marketplace Connect\), don't connect Amazon here too/)).toBeTruthy();
    cleanup();
    renderApp(<ConnectForm kind="amazon" store={store('amazon')} onDone={() => {}} />);
    expect(screen.queryByText(/Marketplace Connect/)).toBeNull();
  });

  it('requires the secret on a new connection and shows why the API refused it', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PUT' ? reply({ error: 'CJ rejected the API key' }, 400) : undefined));
    renderApp(<ConnectForm kind="cj" onDone={() => {}} />);

    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.required).toBe(true);
    expect(key.type).toBe('password');
    fireEvent.change(screen.getByLabelText('Account email (optional)'), { target: { value: 'ops@shop.test' } });
    fireEvent.change(key, { target: { value: 'test-key-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect CJ Dropshipping' }));

    expect((await screen.findByRole('alert')).textContent).toContain('CJ rejected the API key');
    expect(sent(fetch)).toEqual({ kind: 'cj', values: { email: 'ops@shop.test', apiKey: 'test-key-1' }, version: 0 });
  });
});

describe('Sync now', () => {
  it('asks for a sync of a connection that failed, then waits for the loop to run it', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'POST' ? reply({}, 202) : undefined));
    renderApp(<Connection i={{ ...saved, kind: 'shopify', status: 'error', error: 'Missing read_orders scope' }} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    const queued = await screen.findByRole('button', { name: 'Sync queued' });
    expect((queued as HTMLButtonElement).disabled).toBe(true);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url)).toEqual(['/api/integrations/i1/sync']);
  });

  it("isn't offered for a tool that doesn't sync data", () => {
    stubApi(() => undefined);
    renderApp(<Connection i={{ ...saved, kind: 'higgsfield' }} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
  });
});

describe('connection notice', () => {
  it("shows core's note on a working connection, in full", () => {
    stubApi(() => undefined);
    const notice = "Meta Ads reports its days in America/Phoenix, 16 h behind the store's Asia/Tokyo, so a day's ad spend covers other hours than its sales.";
    renderApp(<Connection i={{ ...saved, kind: 'meta_ads', notice }} onOpen={() => {}} />);
    expect(screen.getByText(notice).className).not.toContain('truncate');
  });
});

describe('Claude card', () => {
  it('says how to sign in, then checks again', async () => {
    const fetch = stubApi((url) =>
      url === '/api/claude-account?refresh=1'
        ? { signedIn: true, email: 'owner@shop.test', subscription: 'Claude Max', checkedAt: '2026-10-26T08:00:00Z' }
        : { signedIn: false, checkedAt: '2026-10-26T08:00:00Z' },
    );
    renderApp(<ClaudeCard />);
    expect(await screen.findByText(/Not signed in/)).toBeTruthy();
    expect(screen.getByText(/\/login/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/owner@shop\.test/)).toBeTruthy();
    expect(screen.getByText(/Claude Max/)).toBeTruthy();
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/claude-account?refresh=1');
  });

  it("says why it couldn't ask", async () => {
    stubApi(() => ({ signedIn: false, checkedAt: '2026-10-26T08:00:00Z', error: 'FRONTLINE_AGENT_ENGINE=demo: agents run on the demo engine' }));
    renderApp(<ClaudeCard />);
    expect(await screen.findByText(/demo engine/)).toBeTruthy();
  });
});

describe('a second sales platform on a store', () => {
  const paws = { id: 'paws', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true } as Store;

  it('can be connected from Store Platforms, and the store then shows under that platform', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [paws] : url.startsWith('/api/integrations') ? [] : undefined));
    renderApp(<Integrations />);
    await screen.findByText('Also sells on another platform?');
    expect(screen.queryByRole('heading', { name: 'Amazon SP-API' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Platform' }), { target: { value: 'amazon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect another platform' }));
    expect(await screen.findByText(/If Pawsome Gear's Shopify already imports its Amazon orders/)).toBeTruthy();
  });

  it('lists a store under a second platform it is connected to', async () => {
    const amazon: Integration = { id: 'amazon:paws', kind: 'amazon', storeId: 'paws', status: 'connected', settings: {}, secretsSet: [], updatedAt: '2026-10-26T08:00:00Z' };
    stubApi((url) => (url.startsWith('/api/stores') ? [paws] : url.startsWith('/api/integrations') ? [amazon] : undefined));
    renderApp(<Integrations />);
    const card = (await screen.findByRole('heading', { name: 'Amazon SP-API' })).parentElement!;
    expect(card.textContent).toContain('Pawsome Gear');
    expect(card.textContent).toContain('Manage');
  });
});

describe('Integrations with no stores', () => {
  it("says to add a store first, rather than dropping the store and ad sections without a word", async () => {
    stubApi((url) => (url.startsWith('/api/stores') || url.startsWith('/api/integrations') ? [] : undefined));
    renderApp(<Integrations />, '/settings/integrations');
    expect(await screen.findByText('No stores yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a store' }).getAttribute('href')).toBe('/settings/stores');
  });
});

describe('disconnecting', () => {
  it('asks with focus on Keep, and Keep hands focus back to Disconnect', async () => {
    stubApi(() => undefined);
    renderApp(<ConnectForm kind="cj" current={saved} onDone={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Disconnect' }));
  });
});

describe('another shop', () => {
  it("warns before a save that would drop the connected shop's data, not for the same shop written differently", async () => {
    stubApi(() => undefined);
    const shop: Integration = { ...saved, kind: 'shopify', storeId: 'glow', settings: { shopDomain: 'glow.myshopify.com' } };
    const glow = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#f00', connected: true } as Store;
    renderApp(<ConnectForm kind="shopify" store={glow} current={shop} onDone={() => {}} />);
    const field = await screen.findByLabelText('Shop domain');
    fireEvent.change(field, { target: { value: 'volt.myshopify.com' } });
    expect(screen.getByText(/drops the old shop's orders, products and unit costs/)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'https://GLOW.myshopify.com/' } });
    expect(screen.queryByText(/drops the old shop's orders/)).toBeNull();
  });
});
