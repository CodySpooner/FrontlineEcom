// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import type { AgentStatus } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { SystemStatus } from './Shell';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const render = (...statuses: AgentStatus[]) => {
  stubApi((url) => (url.startsWith('/api/agents') ? statuses.map((status, i) => ({ id: `s:${i}`, storeId: 's', role: 'copywriter', status })) : url.startsWith('/api/health') ? { connectors: [] } : []));
  renderApp(<SystemStatus online />);
};

describe('SystemStatus', () => {
  it("doesn't raise an alarm for agents the owner switched off", async () => {
    render('idle', 'running', 'offline');
    expect(await screen.findAllByText('2 agents online · 1 off')).toBeTruthy();
  });

  it('flags an agent whose last run failed', async () => {
    render('idle', 'error', 'offline');
    expect(await screen.findAllByText('1 agent needs attention')).toBeTruthy();
  });
});
