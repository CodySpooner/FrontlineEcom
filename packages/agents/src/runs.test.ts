import type { AgentEvent } from '@frontline/shared';
import { expect, test } from 'vitest';
import { runGist } from './runs';

const say = (...text: string[]): AgentEvent[] => text.map((t) => ({ type: 'text_delta', text: t }));
const tool: AgentEvent[] = [{ type: 'tool_call', id: '1', name: 'store_summary', input: {} }, { type: 'tool_result', id: '1', output: '{}', isError: false }];

test('the gist is the first sentence of the final answer, without markdown', () => {
  expect(runGist([...say('Let me check.'), ...tool, ...say('## Daily briefing\n\n- **Revenue** fell 12% to 4,210 USD. ROAS held at 2.4.')])).toBe('Revenue fell 12% to 4,210 USD.');
  expect(runGist(say('Paused 1 campaign'))).toBe('Paused 1 campaign');
  expect(runGist(say(`${'word '.repeat(60)}end.`), 40)).toBe(`${'word '.repeat(7).trim()}…`);
  expect(runGist([...say('Checking.'), ...tool])).toBeUndefined(); // ended on a tool step: no final answer
});
