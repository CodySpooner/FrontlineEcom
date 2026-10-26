// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { AGENT_ROLES, type Store } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Onboarding } from './Onboarding';

const added = { id: 'trail-co', name: 'Trail Co', platform: 'shopify', niche: 'outdoor', nicheDetail: 'ultralight camping gear', currency: 'USD', color: '#ff2a3a', connected: false } as Store;
const squad = Object.keys(AGENT_ROLES).map((role) => ({ id: `trail-co:${role}`, storeId: 'trail-co', role, rank: 'Recruit' }));
const dialog = () => document.querySelector('dialog')!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('onboarding', () => {
  it('stays away once the owner has picked a path', () => {
    localStorage.setItem('frontline:onboarded', '1');
    stubApi(() => []);
    renderApp(<Onboarding />);
    expect(dialog().open).toBe(false);
  });

  it('first run: Explore the demo closes it for good', () => {
    stubApi(() => []);
    renderApp(<Onboarding />);
    expect(dialog().open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Explore the demo/ }));
    expect(dialog().open).toBe(false);
    expect(localStorage.getItem('frontline:onboarded')).toBe('1');
  });

  it('add my store → meet the squad → the Dashboard with that store picked', async () => {
    let created = false;
    const fetch = stubApi((url, init) => {
      if (url === '/api/stores' && init?.method === 'POST') {
        created = true;
        return added;
      }
      if (url.startsWith('/api/stores')) return created ? [added] : [];
      if (url.startsWith('/api/agents')) return created ? squad : [];
    });
    renderApp(<Onboarding />, '/settings');
    fireEvent.click(screen.getByRole('button', { name: /Add my store/ }));
    fireEvent.change(screen.getByLabelText('Store name'), { target: { value: 'Trail Co' } });
    fireEvent.change(screen.getByLabelText('Niche'), { target: { value: 'outdoor' } });
    fireEvent.change(screen.getByLabelText('Sub-niche (optional)'), { target: { value: 'ultralight camping gear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add store' }));

    expect(await screen.findByText('Meet your squad')).toBeTruthy();
    expect(await screen.findByText(AGENT_ROLES.market_analyst.name)).toBeTruthy();
    expect(screen.getByText(/reading the ultralight camping gear niche pack/)).toBeTruthy();
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ name: 'Trail Co', niche: 'outdoor', nicheDetail: 'ultralight camping gear' });

    fireEvent.click(screen.getByRole('button', { name: 'Open the Command Center' }));
    expect(dialog().open).toBe(false);
    expect(screen.getByTestId('where').textContent).toBe('/');
    expect(JSON.parse(localStorage.getItem('fe.stores')!)).toEqual(['trail-co']);
  });
});
