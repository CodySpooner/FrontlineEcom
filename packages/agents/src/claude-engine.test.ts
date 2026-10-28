import type { SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { expect, test } from 'vitest';
import { isAccountError, toAgentEvents } from './claude-engine';

test.each([
  ['account_on_hold', /account is on hold/],
  ['oauth_org_not_allowed', /organization doesn't allow Claude Code/],
  ['verification_required', /verify your account/],
  ['cloud_credential_error', /cloud provider credentials failed/],
] as const)('%s stops immediately with a recognized account error', (code, message) => {
  const frame = { type: 'assistant', parent_tool_use_id: null, error: code, message: { content: [{ type: 'text', text: 'SDK account failure' }] } };
  const [event] = toAgentEvents(frame as SDKMessage);
  expect(event).toEqual({ type: 'error', code, message: expect.stringMatching(message) });
  if (event?.type !== 'error') throw new Error('Expected an account error');
  expect(isAccountError(event.message)).toBe(true);
  expect(toAgentEvents({ ...frame, parent_tool_use_id: 'nested' } as SDKMessage)).toEqual([]);
  const result = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['raw SDK error'], session_id: 'session', total_cost_usd: 0.02,
    usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
  expect(toAgentEvents(result as SDKMessage, undefined, code as SDKAssistantMessageError)).toEqual([
    { ...event, sessionId: 'session', usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.02 } },
  ]);
});
