// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { OrderIssue } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { AgentIssue, Orders } from './Orders';

const issue: OrderIssue = {
  id: 'oi1',
  storeId: 'peak',
  orderId: '#1042',
  agentId: 'peak:operations',
  kind: 'late',
  severity: 'high',
  note: 'Ordered 9 days ago, still unfulfilled',
  status: 'open',
  createdAt: '2026-10-26T08:00:00Z',
};
const patched = (fetch: ReturnType<typeof stubApi>) => fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init!.body))]);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('agent-flagged order issue', () => {
  it('resolves with what fixed it, so Operations can learn from it', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? { ...issue, status: 'resolved' } : undefined));
    renderApp(<AgentIssue i={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    fireEvent.change(screen.getByLabelText('What fixed #1042'), { target: { value: ' Supplier reshipped, new tracking sent ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await vi.waitFor(() => expect(patched(fetch)).toEqual([['/api/order-issues/oi1', { status: 'resolved', resolution: 'Supplier reshipped, new tracking sent' }]]));
  });

  it('resolves without a note, and shows why the API refused', async () => {
    const fetch = stubApi((_url, init) => (init?.method === 'PATCH' ? reply({ error: 'Issue not found' }, 404) : undefined));
    renderApp(<AgentIssue i={issue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Issue not found');
    expect(patched(fetch)).toEqual([['/api/order-issues/oi1', { status: 'resolved' }]]);
  });
});

describe('orders table', () => {
  it("links a tracking number to the carrier's page", async () => {
    const order = { id: '#1201', storeId: 'peak', createdAt: '2026-10-26T08:00:00Z', total: 30, status: 'paid', fulfillmentStatus: 'in_transit', tracking: 'LX123', trackingUrl: 'https://t.17track.net/en#nums=LX123' };
    stubApi((url) => (url.startsWith('/api/orders?') ? { items: [order], total: 1 } : undefined));
    renderApp(<Orders />, '/orders');
    const link = await screen.findByRole('link', { name: 'LX123' });
    expect(link.getAttribute('href')).toBe('https://t.17track.net/en#nums=LX123');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
