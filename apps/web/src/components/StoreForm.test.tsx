// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { StoreForm } from './StoreForm';

const sent = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'POST' || init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init!.body))]);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('store form time zone', () => {
  it("starts at this computer's zone and sends the one picked", async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'POST' ? { id: 's1' } : undefined));
    renderApp(<StoreForm onDone={() => {}} />);
    const zone = screen.getByLabelText(/Time zone/) as HTMLSelectElement;
    expect(zone.value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    fireEvent.change(screen.getByLabelText('Store name'), { target: { value: 'Trail Co' } });
    fireEvent.change(zone, { target: { value: 'America/Denver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add store' }));
    await vi.waitFor(() => expect(sent(fetch)[0]?.[1]).toMatchObject({ name: 'Trail Co', timezone: 'America/Denver' }));
  });

  it("keeps a store's saved zone even when the list doesn't name it", () => {
    stubApi(() => undefined);
    const store = { id: 'peak', name: 'Peak Fit', platform: 'etsy', niche: 'fitness', currency: 'USD', timezone: 'UTC', color: '#ff2a3a', connected: true } as Store;
    renderApp(<StoreForm store={store} onDone={() => {}} />);
    expect((screen.getByLabelText(/Time zone/) as HTMLSelectElement).value).toBe('UTC');
  });
});
