import { expect, test } from 'vitest';
import { parseLearnings } from './memory';

const fact = { kind: 'fact', text: 'Ships from Austin [2]', evidence: 'A quoted "]" in the source', tags: ['ops'] };
test.each([
  JSON.stringify([fact]) + '\nSee step [2].',
  'From [store_summary] (step [2]):\n' + JSON.stringify([fact]) + '\nSee [3].',
  '```json\n' + JSON.stringify([null, 2, fact]) + '\n```\nSee [2].',
])('reflection finds its array closing bracket in %s', (reply) => {
  expect(parseLearnings(reply)).toEqual([{ ...fact, confidence: 0.5 }]);
});

test('empty and incomplete reflections return no learnings', () => {
  expect(parseLearnings('[]\nSee step [2].')).toEqual([]);
  expect(parseLearnings('[{"kind":"fact","text":"Unfinished')).toEqual([]);
});
