// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { feeEstimate, StoreForm } from './StoreForm';

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

describe('store form fees', () => {
  const etsy = { id: 'clay', name: 'Clay Co', platform: 'etsy', niche: 'home', currency: 'USD', timezone: 'UTC', color: '#ff2a3a', connected: true } as Store;

  it("hints the platform's usual fees and sends the owner's estimate", async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? etsy : undefined));
    renderApp(<StoreForm store={etsy} onDone={() => {}} />);
    expect(screen.getByText(/Typical on Etsy: 9.5% \+ 0.25 per order/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Fees, % of revenue'), { target: { value: '9.5' } });
    fireEvent.change(screen.getByLabelText('Fees per order'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save store' }));
    await vi.waitFor(() => expect(sent(fetch)[0]).toEqual(['/api/stores/clay', expect.objectContaining({ feePercent: 9.5, feePerOrder: 0.25 })]));
  });

  it('clears a saved estimate back to no fees', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? etsy : undefined));
    renderApp(<StoreForm store={{ ...etsy, feePercent: 9.5 }} onDone={() => {}} />);
    const pct = screen.getByLabelText('Fees, % of revenue') as HTMLInputElement;
    expect(pct.value).toBe('9.5');
    fireEvent.change(pct, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save store' }));
    await vi.waitFor(() => expect(sent(fetch)[0]?.[1]).toMatchObject({ feePercent: 0, feePerOrder: 0 }));
  });
});

describe('feeEstimate', () => {
  it('reads the estimate back the way the form takes it, nothing when unset', () => {
    expect(feeEstimate({ feePercent: 9.5, feePerOrder: 0.25 })).toBe('Fees 9.5% + 0.25 per order');
    expect(feeEstimate({ feePercent: 15 })).toBe('Fees 15%');
    expect(feeEstimate({ feePerOrder: 0.3 })).toBe('Fees 0.30 per order');
    expect(feeEstimate({})).toBeUndefined();
  });
});

describe('store form currency', () => {
  const shop = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', currency: 'USD', timezone: 'UTC', color: '#ff2a3a', connected: true } as Store;

  it("is the platform's on a connected store: read-only, so a change can't close its waiting requests", () => {
    stubApi(() => undefined);
    renderApp(<StoreForm store={shop} onDone={() => {}} />);
    expect((screen.getByLabelText('Currency') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/Shopify sets it/)).toBeTruthy();
  });

  it('stays editable on a demo store', () => {
    stubApi(() => undefined);
    renderApp(<StoreForm store={{ ...shop, connected: false }} onDone={() => {}} />);
    expect((screen.getByLabelText('Currency') as HTMLInputElement).readOnly).toBe(false);
  });
});
