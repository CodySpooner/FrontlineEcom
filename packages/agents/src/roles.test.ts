import { AGENT_ROLES, type AgentRole } from '@frontline/shared';
import { expect, test } from 'vitest';
import { DEFAULT_JOBS, playbook, ROLES } from './index';

const roles = Object.keys(AGENT_ROLES) as AgentRole[];

test('every role can read its store, use memory and ask for approval', () => {
  for (const role of roles) {
    expect(ROLES[role].tools).toEqual(expect.arrayContaining(['store_summary', 'search_memory', 'write_memory', 'request_approval']));
    expect(new Set(ROLES[role].tools).size).toBe(ROLES[role].tools.length);
  }
});

test('only Creative Strategist spends generation credits', () => {
  expect(roles.filter((r) => ROLES[r].tools.includes('create_creative'))).toEqual(['creative_studio', 'copywriter']);
});

test('a playbook or default job only names tools its role has', () => {
  const known = new Set(roles.flatMap((r) => ROLES[r].tools as string[]));
  for (const role of roles) {
    const text = [playbook(role), ...DEFAULT_JOBS.filter((j) => j.role === role).map((j) => j.task)].join('\n');
    const named = [...new Set(text.match(/\w+/g))].filter((w) => known.has(w));
    expect({ role, missing: named.filter((w) => !(ROLES[role].tools as string[]).includes(w)) }).toEqual({ role, missing: [] });
  }
});
