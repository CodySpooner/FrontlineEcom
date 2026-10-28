// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent, AgentRunDetail, ApprovalRequest } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { ApprovalCard, Transcript } from './Chat';

const agent = { id: 'peak:copywriter', storeId: 'peak', role: 'copywriter', enabled: true } as Agent;
const run = (id: string, status: AgentRunDetail['status'], extra: Partial<AgentRunDetail> = {}): AgentRunDetail => ({
  id,
  storeId: 'peak',
  agentId: agent.id,
  task: 'Draft 3 headlines',
  status,
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  createdAt: '2026-10-26T08:00:00Z',
  transcript: [],
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a finished run', () => {
  it('offers nothing to retry', async () => {
    stubApi(() => undefined);
    renderApp(<Transcript run={run('r1', 'done')} role="copywriter" />);
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // It offers to research the question further instead (KB-15).
    expect(screen.getByRole('link', { name: 'Research this' }).getAttribute('href')).toBe('/knowledge?view=research&ws=peak&ask=Draft+3+headlines');
  });
});

describe('knowledge citations', () => {
  it('turns [kb:<id>] in an answer into a link to that card, named by its title; an id with no card stays as written', async () => {
    const answer = 'Lead with the problem [kb:c1], as [kb:c1] says. [kb:gone] is not a card.';
    stubApi((url) => {
      if (url === '/api/kb/cards/c1?ws=all') return { id: 'c1', storeId: 'peak', title: 'Problem-first hooks win' };
      if (url === '/api/kb/cards/gone?ws=all') return new Response(JSON.stringify({ error: 'card not found' }), { status: 404 });
    });
    renderApp(<Transcript run={run('r1', 'done', { task: 'Use [kb:c1] for 3 headlines', transcript: [{ type: 'text_delta', text: answer.slice(0, 30) }, { type: 'text_delta', text: answer.slice(30) }] })} role="copywriter" />);
    const links = await screen.findAllByRole('link', { name: 'Problem-first hooks win' });
    // The owner's question names it too (Use in a task).
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/knowledge?card=c1', '/knowledge?card=c1', '/knowledge?card=c1']);
    expect(links[0]!.closest('p')!.textContent).toBe('Use Problem-first hooks win for 3 headlines');
    await vi.waitFor(() => expect(links[1]!.closest('p')!.textContent).toBe('Lead with the problem Problem-first hooks win, as Problem-first hooks win says. [kb:gone] is not a card.'));
  });
});

describe('a run a daily AI budget stopped', () => {
  it("links to the setting that lifts it", async () => {
    const error = "Stopped: today's budget for this agent ($0.3) is used up. Raise it in its settings.";
    stubApi(() => undefined);
    renderApp(<Transcript run={run('r1', 'error', { error, transcript: [{ type: 'error', message: error }] })} role="copywriter" />);
    const link = await screen.findByRole('link', { name: "Raise the agent's budget" });
    expect(link.getAttribute('href')).toBe('/agents/peak%3Acopywriter?tab=settings');
    expect(screen.getAllByText(/is used up/)).toHaveLength(1); // the footer doesn't repeat the transcript's error
  });
});

describe('a request card in a past transcript', () => {
  const asked = { id: 'a1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Pause UGC', reason: 'ROAS 0.8', status: 'pending', createdAt: '2026-10-26T08:00:00Z', action: { kind: 'ads.pause_campaign', payload: {} } } as ApprovalRequest;
  const render = (approved: ApprovalRequest[], denied: ApprovalRequest[]) => {
    stubApi((url) => (url.startsWith('/api/approvals?status=approved') ? approved : url.startsWith('/api/approvals?status=denied') ? denied : []));
    renderApp(<ApprovalCard a={asked} />);
  };

  it('says how it ended when it was decided elsewhere', async () => {
    render([{ ...asked, status: 'approved' }], []);
    expect(await screen.findByText('Approved')).toBeTruthy();
    expect(screen.queryByText(/Needs your approval/)).toBeNull();
  });

  it("tells a request the app closed apart from the owner's no", async () => {
    render([], [{ ...asked, status: 'denied', reason: 'ROAS 0.8 [Expired: the agent run ended before a decision.]' }]);
    expect(await screen.findByText('Expired')).toBeTruthy();
  });
});

describe('backing out of a deny on a request card', () => {
  it('puts focus back on Deny', async () => {
    const a = { id: 'a1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Pause UGC', reason: 'ROAS 0.8', status: 'pending', createdAt: '2026-10-26T08:00:00Z', action: { kind: 'ads.pause_campaign', payload: {} } } as ApprovalRequest;
    stubApi((url) => (url.startsWith('/api/approvals?status=pending') ? [a] : []));
    renderApp(<ApprovalCard a={a} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deny: Pause UGC' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deny: Pause UGC' }));
  });
});

describe('the amber tone (the AI Agents thread)', () => {
  const a = { id: 'a1', storeId: 'peak', agentId: 'peak:ad_strategist', title: 'Pause UGC', reason: 'ROAS 0.8', status: 'pending', createdAt: '2026-10-26T08:00:00Z', action: { kind: 'ads.pause_campaign', payload: {} } } as ApprovalRequest;
  const order = () => screen.getAllByRole('button').map((b) => b.textContent);

  it('puts Deny… before Approve under an amber label; the default card is unchanged', async () => {
    stubApi((url) => (url.startsWith('/api/approvals?status=pending') ? [a] : []));
    const { container } = renderApp(<ApprovalCard a={a} tone="amber" />);
    await screen.findByRole('button', { name: 'Approve: Pause UGC' });
    expect(order()).toEqual(['Deny…', 'Approve']);
    expect(screen.getByText(/^Approval needed/).className).toContain('text-amber');
    expect(container.querySelector('[class*="border-amber/38"]')).toBeTruthy();
    cleanup();
    renderApp(<ApprovalCard a={a} />);
    await screen.findByRole('button', { name: 'Approve: Pause UGC' });
    expect(order()).toEqual(['Approve', 'Deny']);
    expect(screen.getByText(/^Needs your approval/).className).toContain('text-red');
  });
});

describe('deciding a card in a waiting list', () => {
  it('moves focus on to the next card still open, as the decided one drops out', async () => {
    const asks = ['A', 'B'].map((t, i) => ({ id: `a${i + 1}`, storeId: 'peak', agentId: 'peak:ad_strategist', title: `Pause ${t}`, reason: 'ROAS 0.8', status: 'pending', createdAt: '2026-10-26T08:00:00Z', action: { kind: 'ads.pause_campaign', payload: {} } }) as ApprovalRequest);
    stubApi((url, init) => (init?.method === 'POST' ? { ...asks[0], status: 'approved' } : url.startsWith('/api/approvals?status=pending') ? asks : []));
    renderApp(
      <section>
        {asks.map((a) => (
          <ApprovalCard key={a.id} a={a} />
        ))}
      </section>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve: Pause A' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve: Pause B' }));
  });
});
