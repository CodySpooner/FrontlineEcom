// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Integration } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { ConnectForm, Connection } from './Integrations';

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
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: ' buyer@shop.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent(fetch)).toEqual({ kind: 'cj', values: { email: 'buyer@shop.test' } });
  });

  it('requires the secret on a new connection and shows why the API refused it', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PUT' ? reply({ error: 'CJ rejected the API key' }, 400) : undefined));
    renderApp(<ConnectForm kind="cj" onDone={() => {}} />);

    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.required).toBe(true);
    expect(key.type).toBe('password');
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'ops@shop.test' } });
    fireEvent.change(key, { target: { value: 'test-key-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect CJ Dropshipping' }));

    expect((await screen.findByRole('alert')).textContent).toContain('CJ rejected the API key');
    expect(sent(fetch)).toEqual({ kind: 'cj', values: { email: 'ops@shop.test', apiKey: 'test-key-1' } });
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
