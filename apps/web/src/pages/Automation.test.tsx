// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ApprovalRequest, AutomationRule, AutomationRun } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { RunLog } from './Automation';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rule = { id: 'r1', storeId: 'peak', name: 'Weekly ad review', enabled: true, action: { type: 'agent_task', agentId: 'peak:ad_strategist', task: 'Review ads' } } as AutomationRule;
const run: AutomationRun = { id: 'l1', ruleId: 'r1', storeId: 'peak', firedAt: new Date().toISOString(), status: 'awaiting_approval', detail: 'Monday 09:00', approvalId: 'a1' };
const ask = { id: 'a1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Run automation "Weekly ad review"', reason: 'Scheduled', status: 'pending', createdAt: run.firedAt, action: { kind: 'automation.run', payload: { ruleId: 'r1' } } } as ApprovalRequest;

describe('automation run log', () => {
  it('decides a waiting request right in the log', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { ...ask, status: 'approved' };
      if (url.startsWith('/api/automations/runs')) return [run];
      if (url.startsWith('/api/approvals?status=pending')) return [ask];
      if (url.startsWith('/api/stores')) return [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }];
    });
    renderApp(<RunLog rules={[rule]} />, '/automation');
    fireEvent.click(await screen.findByRole('button', { name: `Approve: ${ask.title}` }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/approve', { method: 'POST' }));
  });

  it('falls back to the Dashboard link when the request is not in the waiting list', async () => {
    stubApi((url) => (url.startsWith('/api/automations/runs') ? [run] : url.startsWith('/api/stores') ? [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }] : []));
    renderApp(<RunLog rules={[rule]} />, '/automation');
    expect(await screen.findByRole('link', { name: 'Review it on the Dashboard' })).toBeTruthy();
  });
});
