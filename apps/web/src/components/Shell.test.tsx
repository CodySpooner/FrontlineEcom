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

  it('says when the Claude login that live stores run on is signed out', async () => {
    stubApi((url) =>
      url.startsWith('/api/agents')
        ? [{ id: 's:copywriter', storeId: 's', role: 'copywriter', status: 'idle', engine: { provider: 'claude' } }]
        : url.startsWith('/api/health')
          ? { connectors: [] }
          : url.startsWith('/api/claude-account')
            ? { signedIn: false, checkedAt: '2026-10-26T08:00:00Z' }
            : [],
    );
    renderApp(<SystemStatus online />);
    const links = (await screen.findAllByText('Check Claude login')).map((e) => e.closest('a')?.getAttribute('href'));
    expect(links).toContain('/settings/agents');
  });

  it("doesn't check the Claude login when every store runs on the demo engine", async () => {
    const fetch = stubApi((url) =>
      url.startsWith('/api/agents') ? [{ id: 's:copywriter', storeId: 's', role: 'copywriter', status: 'idle', engine: { provider: 'demo' } }] : url.startsWith('/api/health') ? { connectors: [] } : [],
    );
    renderApp(<SystemStatus online />);
    expect(await screen.findAllByText('All agents online')).toBeTruthy();
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/claude-account'))).toBe(false);
  });
});
