// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { ApprovalRequest, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { Requests } from './Dashboard';

const store = { id: 'pawsome', name: 'Pawsome Gear', currency: 'USD' } as Store;
const approval: ApprovalRequest = {
  id: 'a1',
  storeId: 'pawsome',
  agentId: 'pawsome:ad_strategist',
  title: 'Raise daily budget 20%',
  reason: 'ROAS above 3.0 for 5 days',
  action: { kind: 'ads.set_budget', payload: {}, amountUsd: 12 },
  status: 'pending',
  createdAt: '2026-10-26T08:00:00Z',
};

/** Fake API: the pending request, its store and agent; the decide POST answers with `decideStatus`. */
function serve(decideStatus: number) {
  const fetch = stubApi((url, init) => {
    if (init?.method === 'POST') return decideStatus === 200 ? { ...approval, status: 'approved' } : reply({ error: 'nope' }, decideStatus);
    if (url.startsWith('/api/approvals?status=pending')) return [approval];
    if (url.startsWith('/api/stores')) return [store];
    if (url.startsWith('/api/agents')) return [{ id: approval.agentId, storeId: 'pawsome', role: 'ad_strategist' }];
  });
  renderApp(<Requests />);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('approvals flow', () => {
  it('shows the request with its kind, reason and money at stake', async () => {
    serve(200);
    expect(await screen.findByText('Raise daily budget 20%')).toBeTruthy();
    expect(screen.getByText(/Change ad budgets/)).toBeTruthy();
    expect(screen.getByText(/\$12\/day at stake/)).toBeTruthy();
    expect(screen.getByText('1 waiting')).toBeTruthy();
  });

  it('approves: posts the verdict and shows it', async () => {
    const fetch = serve(200);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Raise daily budget 20%' }));
    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/approve', { method: 'POST' });
    expect(screen.getByText('all clear')).toBeTruthy();
  });

  it('denies with the reason the owner gives, so the squad learns why', async () => {
    const fetch = serve(200);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny: Raise daily budget 20%' }));
    fireEvent.change(screen.getByLabelText('Why deny Raise daily budget 20%?'), { target: { value: ' Too early in the month ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deny: Raise daily budget 20%' }));
    expect(await screen.findByText('Denied')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/approvals/a1/deny', expect.objectContaining({ method: 'POST', body: '{"note":"Too early in the month"}' }));
  });

  it('puts the buttons back and says so when the verdict fails', async () => {
    serve(500);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny: Raise daily budget 20%' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deny: Raise daily budget 20%' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny: Raise daily budget 20%' })).toBeTruthy();
  });
});
