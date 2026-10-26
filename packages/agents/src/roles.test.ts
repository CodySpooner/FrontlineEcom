import { AGENT_ROLES, type AgentRole } from '@frontline/shared';
import { expect, test } from 'vitest';
import { ROLES } from './index';

const roles = Object.keys(AGENT_ROLES) as AgentRole[];

test('every role can read its store, use memory and ask for approval', () => {
  for (const role of roles) {
    expect(ROLES[role].tools).toEqual(expect.arrayContaining(['store_summary', 'search_memory', 'write_memory', 'request_approval']));
    expect(new Set(ROLES[role].tools).size).toBe(ROLES[role].tools.length);
  }
});

test('only Creative Studio spends generation credits', () => {
  expect(roles.filter((r) => ROLES[r].tools.includes('create_creative'))).toEqual(['creative_studio']);
});
