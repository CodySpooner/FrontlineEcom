// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ApprovalRequest, AutomationRule, AutomationRun } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { DemoJobsNote } from '../components/DemoJobsNote';
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

  it("asks the API for the picked stores' runs, so a busy store can't crowd them out of the newest 50", async () => {
    localStorage.setItem('fe.stores', JSON.stringify(['peak']));
    const fetch = stubApi((url) => (url.startsWith('/api/stores') ? [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }, { id: 'glow', name: 'Glow Haus', currency: 'USD' }] : []));
    renderApp(<RunLog rules={[rule]} />, '/automation');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/automations/runs?stores=peak&limit=50', undefined));
    localStorage.removeItem('fe.stores');
  });

  it('falls back to the Dashboard link when the request is not in the waiting list', async () => {
    stubApi((url) => (url.startsWith('/api/automations/runs') ? [run] : url.startsWith('/api/stores') ? [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }] : []));
    renderApp(<RunLog rules={[rule]} />, '/automation');
    expect(await screen.findByRole('link', { name: 'Review it on the Dashboard' })).toBeTruthy();
  });
});

describe('demo stores note', () => {
  it("says a demo store's squad jobs switch on once it's connected, and leaves connected stores out", async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [{ id: 'peak', name: 'Peak Fit', connected: false }, { id: 'glow', name: 'Glow Haus', connected: true }] : undefined));
    renderApp(<DemoJobsNote rules={[{ ...rule, enabled: false }, { ...rule, id: 'r2', storeId: 'glow', enabled: false }]} />, '/automation');
    expect(await screen.findByText(/Peak Fit is a demo store: its squad's jobs switch on when you connect it/)).toBeTruthy();
    expect(screen.queryByText(/Glow Haus/)).toBeNull();
  });
});
