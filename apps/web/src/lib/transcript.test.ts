import { describe, expect, it } from 'vitest';
import type { AgentRunDetail } from '@frontline/shared';
import { applyRunEvent, toBlocks } from './transcript';

const usage = { inputTokens: 10, outputTokens: 20, costUsd: 0.01 };

describe('toBlocks', () => {
  it('merges text, folds tool results into calls, skips done', () => {
    const blocks = toBlocks([
      { type: 'text_delta', text: 'Checking ' },
      { type: 'text_delta', text: 'ads.' },
      { type: 'tool_call', id: 't1', name: 'analytics_summary', input: { range: 7 } },
      { type: 'text_delta', text: 'ROAS is 2.6.' },
      { type: 'tool_result', id: 't1', output: '{"roas":2.6}', isError: false },
      { type: 'done', sessionId: 's', usage },
    ]);
    expect(blocks).toEqual([
      { kind: 'text', text: 'Checking ads.' },
      { kind: 'tool', id: 't1', name: 'analytics_summary', input: { range: 7 }, output: '{"roas":2.6}', isError: false },
      { kind: 'text', text: 'ROAS is 2.6.' },
    ]);
  });

  it('keeps a tool call without a result as pending', () => {
    expect(toBlocks([{ type: 'tool_call', id: 't1', name: 'x', input: {} }])).toEqual([{ kind: 'tool', id: 't1', name: 'x', input: {} }]);
  });
});

describe('applyRunEvent', () => {
  const run: AgentRunDetail = { id: 'r', storeId: 's', agentId: 'a', task: 't', status: 'queued', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: '', transcript: [] };

  it('appends without mutating and marks the run running', () => {
    const next = applyRunEvent(run, { type: 'text_delta', text: 'hi' });
    expect(next.status).toBe('running');
    expect(next.transcript).toHaveLength(1);
    expect(run.transcript).toHaveLength(0);
  });

  it('finishes on done and error', () => {
    expect(applyRunEvent(run, { type: 'done', sessionId: 's1', usage })).toMatchObject({ status: 'done', sessionId: 's1', usage });
    expect(applyRunEvent(run, { type: 'error', message: 'boom' })).toMatchObject({ status: 'error', error: 'boom' });
  });
});
