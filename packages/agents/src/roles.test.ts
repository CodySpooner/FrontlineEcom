import { AGENT_ROLES, type Agent, type AgentRole, type Store } from '@frontline/shared';
import { expect, test } from 'vitest';
import { basicSystemPrompt, ROLES, SQUAD_RULES } from './index';

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

test('basic system prompt carries store, role, kpi and squad rules', () => {
  const store: Store = { id: 'peak', name: 'Peak Fit', platform: 'tiktok_shop', niche: 'fitness', currency: 'USD', timezone: 'America/Chicago', color: '#999', connected: false };
  const agent: Agent = { id: 'peak:ad_strategist', storeId: 'peak', role: 'ad_strategist', status: 'idle', level: 1, xp: 0 };
  const prompt = basicSystemPrompt({ agent, store });
  expect(prompt).toContain('You are the Ad Strategist of Peak Fit, a fitness store on tiktok_shop.');
  expect(prompt).toContain(ROLES.ad_strategist.prompt);
  expect(prompt).toContain(`measured on ${ROLES.ad_strategist.kpi}`);
  expect(prompt).toContain(SQUAD_RULES);
});
