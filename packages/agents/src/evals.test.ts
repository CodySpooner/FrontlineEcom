import { AGENT_ROLES, APPROVAL_KINDS, type AgentRole } from '@frontline/shared';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { APP_TOOLS, DEFAULT_JOBS, MISSION_TEMPLATES, playbook, ROLES, SQUAD_RULES, toolsFor } from './index';

// Evals: the text an agent is given must only ask for tools that agent actually has. Catches drift whenever a
// playbook, a role prompt, the squad rules, a scheduled job or a mission template is edited without updating the role's tool list.

const ROLE_IDS = Object.keys(AGENT_ROLES) as AgentRole[];
const SDK_TOOLS = ['WebSearch', 'WebFetch'];
const KNOWN = new Set<string>([...APP_TOOLS.map((t) => t.name), ...SDK_TOOLS]);
const mentioned = (text: string) => new Set((text.match(/\b(?:[a-z]+(?:_[a-z]+)+|Web(?:Search|Fetch))\b/g) ?? []).filter((w) => KNOWN.has(w)));

test('tool mentions are found in prose and backticks, other words ignored', () => {
  expect([...mentioned('Run `review_campaigns`, then WebFetch the page; skip a_word and list_things.')]).toEqual(['review_campaigns', 'WebFetch']);
});

test('every role tool exists, and app tools are all wired', () => {
  for (const role of ROLE_IDS) {
    for (const t of ROLES[role].tools) expect(KNOWN.has(t), `${role}: ${t}`).toBe(true);
    expect(toolsFor(role).map((t) => t.name).sort(), role).toEqual(ROLES[role].tools.filter((t) => !SDK_TOOLS.includes(t)).sort());
  }
});

test.each(ROLE_IDS)('%s is only told to use tools it has', (role) => {
  expect(mentioned(playbook(role)).size, 'playbook names its tools').toBeGreaterThan(2);
  const jobs = [...DEFAULT_JOBS, ...MISSION_TEMPLATES.flatMap((m) => m.steps)].filter((j) => j.role === role).map((j) => j.task);
  const missing = [...mentioned([playbook(role), ROLES[role].prompt, SQUAD_RULES, ...jobs].join('\n'))].filter((t) => !ROLES[role].tools.includes(t as never));
  expect(missing).toEqual([]);
});

test('every app tool is used by some role', () => {
  const used = new Set(ROLE_IDS.flatMap((r) => ROLES[r].tools));
  expect(APP_TOOLS.map((t) => t.name).filter((t) => !used.has(t))).toEqual([]);
});

test('every approval kind an agent tool or engine produces has an owner-facing label', () => {
  const src = ['tools.ts', 'claude-engine.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  // `kind: 'x.y'` in approval actions, plus the in-run ACTIONS executors (`  save_niche_pack: async ({`).
  const kinds = [...src.matchAll(/kind: '([a-z_]+\.[a-z_]+|tool_use)'|^ {2}(\w+): async \(\{/gm)].map((m) => (m[1] ?? m[2])!);
  expect(kinds).toContain('save_niche_pack');
  for (const k of kinds) expect(APPROVAL_KINDS[k], k).toBeDefined();
});
