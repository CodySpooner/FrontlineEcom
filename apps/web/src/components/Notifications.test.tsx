// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { ApprovalRequest } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { NotificationBell } from './Notifications';

const approval: ApprovalRequest = {
  id: 'a1',
  storeId: 'peak',
  agentId: 'peak:ad_strategist',
  title: 'Pause "Spark Ads · UGC"',
  reason: 'Losing $45/day for 4 days straight',
  action: { kind: 'ads.pause_campaign', payload: {} },
  status: 'pending',
  createdAt: '2026-10-26T08:00:00Z',
};

const decided: ApprovalRequest = {
  ...approval,
  id: 'a0',
  title: 'Raise daily budget 20%',
  action: { kind: 'ads.update_budget', payload: {}, auto: true },
  status: 'approved',
  decidedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('bell drawer', () => {
  it('lists waiting approvals with who asked, and decides them in place', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return { ...approval, status: 'denied' };
      if (url.startsWith('/api/approvals?status=pending')) return [approval];
      if (url.startsWith('/api/approvals?status=approved')) return [decided];
      if (url.startsWith('/api/approvals?status=denied'))
        return [
          { ...approval, id: 'a9', title: 'Add 3 products', status: 'denied', decisionNote: 'Wrong niche', decidedAt: decided.decidedAt },
          { ...approval, id: 'a8', title: 'Pause UGC', status: 'denied', reason: 'ROAS 0.8. [Expired: asked on demo data before the store went live.]', decidedAt: decided.decidedAt },
        ];
      if (url.startsWith('/api/stores')) return [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }];
      if (url.startsWith('/api/agents')) return [{ id: 'peak:ad_strategist', storeId: 'peak', role: 'ad_strategist' }];
    });
    renderApp(<NotificationBell />, '/analytics');
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications: 1 need you' }));

    const waiting = await screen.findByRole('region', { name: 'Waiting on you' });
    expect(await within(waiting).findByText(/Ad Strategist · Peak Fit/)).toBeTruthy();
    const recent = screen.getByRole('region', { name: 'Recently decided' });
    expect(within(recent).getByText('Autopilot approved')).toBeTruthy();
    expect(within(recent).getAllByText(/Ad Strategist · Peak Fit · 2 h ago/)).toHaveLength(3);
    // A denial shows the owner's reason.
    expect(within(recent).getByText(/Wrong niche/)).toBeTruthy();
    // One the app closed on its own isn't the owner's denial.
    expect(within(recent).getByText('Expired')).toBeTruthy();
    expect(within(recent).getByText('Asked on demo data before the store went live.')).toBeTruthy();
    // Requests are waiting, so the empty list below doesn't claim you're caught up.
    expect(await screen.findByText('Nothing else new.')).toBeTruthy();
    expect(screen.queryByText("You're all caught up")).toBeNull();
    fireEvent.click(within(waiting).getByRole('button', { name: `Deny: ${approval.title}` }));
    fireEvent.click(within(waiting).getByRole('button', { name: `Confirm deny: ${approval.title}` }));
    expect(await within(waiting).findByText('Denied')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/deny', { method: 'POST' });
    // Decided from the drawer, no trip to the Dashboard.
    expect(screen.getByTestId('where').textContent).toBe('/analytics');
  });
});
