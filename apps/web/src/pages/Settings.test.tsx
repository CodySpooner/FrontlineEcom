// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { StoreCaps } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { CapsForm } from './Settings';

const caps: StoreCaps = { storeId: 'peak', adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, agentCostPerDay: 5, autopilot: {} };
const amount = () => screen.getByLabelText('Change ad budgets: most per day in dollars');
const puts = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('caps form', () => {
  it("won't send an autopilot rule with a blank amount", async () => {
    const fetch = stubApi(() => undefined);
    renderApp(<CapsForm caps={caps} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Change ad budgets' }));
    fireEvent.change(amount(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save caps' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(puts(fetch)).toHaveLength(0);
  });

  it('turning a rule off with a blank amount saves it as 0', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PUT' ? caps : undefined));
    renderApp(<CapsForm caps={caps} />);
    const rule = screen.getByRole('switch', { name: 'Change ad budgets' });
    fireEvent.click(rule);
    fireEvent.change(amount(), { target: { value: '' } });
    fireEvent.click(rule);
    fireEvent.click(screen.getByRole('button', { name: 'Save caps' }));
    await vi.waitFor(() => expect(puts(fetch)).toHaveLength(1));
    expect(JSON.parse(String(puts(fetch)[0]![1]!.body)).autopilot['ads.set_budget']).toEqual({ enabled: false, maxUsdPerDay: 0 });
  });
});
