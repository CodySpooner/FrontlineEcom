// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent, AgentRunDetail, ApprovalRequest } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { ApprovalCard, Chat } from './Chat';

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

// jsdom has no ResizeObserver; Chat only uses it to keep the newest message in view.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('chat retry', () => {
  it('runs a failed last task again, in the same conversation', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST') return run('r2', 'queued');
      if (url === '/api/runs/r0') return run('r0', 'error', { error: 'Rate limited' });
      if (url === '/api/runs/r1') return run('r1', 'error', { error: 'Interrupted by an app restart', sessionId: 's1' });
    });
    const onThread = vi.fn();
    renderApp(<Chat agent={agent} thread={['r0', 'r1']} onThread={onThread} />);

    // Only the newest message offers it.
    expect(await screen.findByText(/Interrupted by an app restart/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await vi.waitFor(() => expect(onThread).toHaveBeenCalledWith(['r0', 'r1', 'r2']));
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/agents/peak%3Acopywriter/runs');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ task: 'Draft 3 headlines', resumeRunId: 'r1' });
  });

  it('offers nothing to retry after a finished run', async () => {
    stubApi((url) => (url === '/api/runs/r1' ? run('r1', 'done') : undefined));
    renderApp(<Chat agent={agent} thread={['r1']} onThread={() => {}} />);
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
      if (url === '/api/runs/r1') return run('r1', 'done', { task: 'Use [kb:c1] for 3 headlines', transcript: [{ type: 'text_delta', text: answer.slice(0, 30) }, { type: 'text_delta', text: answer.slice(30) }] });
      if (url === '/api/kb/cards/c1?ws=all') return { id: 'c1', storeId: 'peak', title: 'Problem-first hooks win' };
      if (url === '/api/kb/cards/gone?ws=all') return new Response(JSON.stringify({ error: 'card not found' }), { status: 404 });
    });
    renderApp(<Chat agent={agent} thread={['r1']} onThread={() => {}} />);
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
    stubApi((url) => (url === '/api/runs/r1' ? run('r1', 'error', { error, transcript: [{ type: 'error', message: error }] }) : undefined));
    renderApp(<Chat agent={agent} thread={['r1']} onThread={() => {}} />);
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

describe('a conversation from before the store went live', () => {
  it('sends the refused follow-up as a new chat in one click', async () => {
    const fetch = stubApi((url, init) => {
      if (init?.method === 'POST')
        return JSON.parse(String(init.body)).resumeRunId
          ? reply({ error: 'That conversation ran on demo data, before the store went live: start a new one.' }, 409)
          : run('r2', 'queued');
      if (url === '/api/runs/r1') return run('r1', 'done', { sessionId: 's1' });
    });
    const onThread = vi.fn();
    renderApp(<Chat agent={agent} thread={['r1']} onThread={onThread} />);
    await screen.findByText('Done');
    fireEvent.change(screen.getByLabelText('Message Copywriter'), { target: { value: 'Headlines for the real catalog' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Send as a new chat' }));
    await vi.waitFor(() => expect(onThread).toHaveBeenCalledWith(['r2']));
    const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)));
    expect(posts).toEqual([{ task: 'Headlines for the real catalog', resumeRunId: 'r1' }, { task: 'Headlines for the real catalog' }]);
  });
});
