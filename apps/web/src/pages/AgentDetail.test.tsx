// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { AgentBudget } from './AgentDetail';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const agent = { id: 'peak:ad_strategist', storeId: 'peak', role: 'ad_strategist', enabled: true } as Agent;
const patches = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init!.body))]);

describe("an agent's daily AI budget", () => {
  it('saves the amount the owner enters', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? { ...agent, dailyBudgetUsd: 2.5 } : undefined));
    renderApp(<AgentBudget agent={agent} />);
    fireEvent.change(screen.getByLabelText('Daily AI budget'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await vi.waitFor(() => expect(patches(fetch)).toEqual([['/api/agents/peak%3Aad_strategist', { dailyBudgetUsd: 2.5 }]]));
  });

  it("clearing it removes the agent's own cap", async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? agent : undefined));
    renderApp(<AgentBudget agent={{ ...agent, dailyBudgetUsd: 3 }} />);
    const input = screen.getByLabelText('Daily AI budget') as HTMLInputElement;
    expect(input.value).toBe('3');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));
    await vi.waitFor(() => expect(patches(fetch)).toEqual([['/api/agents/peak%3Aad_strategist', { dailyBudgetUsd: null }]]));
  });
});
