import { AGENT_ROLES, APPROVAL_KINDS, type Agent, type AgentRole, type Store } from '@frontline/shared';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { APP_TOOLS, assemblePrompt, BUILTIN_TYPES, CHECKS_LAST, contractOf, contractText, DEFAULT_JOBS, MISSION_TEMPLATES, playbook, ROLES, runTools, SQUAD_RULES, toolsFor, validateCustomRole, WORKFLOW_FIRST } from './index';

// Evals: the text an agent is given must only ask for tools that agent actually has. Catches drift whenever a
// playbook, a role prompt, the squad rules, a scheduled job or a mission template is edited without updating the role's tool list.

const ROLE_IDS = Object.keys(AGENT_ROLES) as AgentRole[];
const SDK_TOOLS = ['WebSearch']; // WebFetch is an app tool (AA-23)
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
  const has = new Set<string>([...ROLES[role].tools, ...runTools(role).map((t) => t.name)]); // save_research_report: every Product Researcher run (T4)
  const missing = [...mentioned([playbook(role), contractText(contractOf(ROLES[role])), SQUAD_RULES, ...jobs].join('\n'))].filter((t) => !has.has(t));
  expect(missing).toEqual([]);
});

// Role contracts (decision 2): a type's prompt is built from its contract, whose workflow opens and whose checks end
// with the shared steps. Built-in types get their own contract and none of their base role's text.
const glow = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#fff', connected: false } as Store;
const seat = (role: AgentRole): Agent => ({ id: `glow:${role}`, storeId: 'glow', role, status: 'idle' });
const BUILTIN_IDS = Object.keys(BUILTIN_TYPES);

test.each([...ROLE_IDS, ...BUILTIN_IDS])("%s's prompt holds its contract, with the shared workflow step and quality checks", (id) => {
  const builtin = BUILTIN_TYPES[id];
  const spec = builtin ?? ROLES[id as AgentRole];
  const prompt = assemblePrompt({ agent: seat(builtin?.baseRole ?? (id as AgentRole)), store: glow, ...(builtin ? { customRole: { id, name: builtin.name, description: builtin.description, instructions: '' } } : {}) });
  const contract = contractOf(spec);
  expect(prompt).toContain(contractText(contract));
  for (const step of [WORKFLOW_FIRST, ...CHECKS_LAST]) expect(prompt).toContain(step);
  expect(contract.outputs.length && contract.knowledge.length && spec.workflow.length && spec.checks.length).toBeGreaterThan(0);
  expect(prompt).toContain('[measured]');
  if (!builtin) return;
  expect(prompt).toContain(`You are the ${builtin.name} of Glow Haus`);
  for (const base of [ROLES.market_analyst.prompt, ROLES.market_analyst.kpi, playbook('market_analyst')]) expect(prompt).not.toContain(base);
  expect([...mentioned(contractText(contract))].filter((t) => !builtin.tools.includes(t as never))).toEqual([]);
});

test("a custom role narrows its base role's tools and adds its instructions to the base contract, never a tool", () => {
  expect(validateCustomRole({ name: 'Voice', baseRole: 'copywriter', tools: ['list_products', 'propose_ad_change'] })).toEqual({ field: 'tools', error: expect.stringContaining('"propose_ad_change"') });
  expect(validateCustomRole({ name: 'Voice', baseRole: 'copywriter', tools: ['list_products', 'compare_stores'] })).toMatchObject({ field: 'tools' });
  expect(validateCustomRole({ name: 'Voice', baseRole: 'copywriter', tools: ['list_products', 'list_products'] })).toMatchObject({ tools: ['list_products'] });
  const prompt = assemblePrompt({ agent: seat('copywriter'), store: glow, customRole: { id: 'c1', name: 'Brand Voice', description: 'Keeps every line on brand.', instructions: 'Never use exclamation marks.' } });
  expect(prompt).toContain('You are the Brand Voice of Glow Haus');
  for (const part of [contractText(contractOf(ROLES.copywriter)), playbook('copywriter'), '# Your role: Brand Voice', 'Never use exclamation marks.']) expect(prompt).toContain(part);
});

test('every app tool is used by some role', () => {
  const used = new Set(ROLE_IDS.flatMap((r) => ROLES[r].tools));
  // save_finding comes with a config's save-findings setting, not with a role (decision 11); save_research_report with every
  // Product Researcher run, whatever its config lists (product-research T4).
  expect(APP_TOOLS.map((t) => t.name).filter((t) => !used.has(t) && t !== 'save_finding' && t !== 'save_research_report')).toEqual([]);
});

test('every approval kind an agent tool or engine produces has an owner-facing label', () => {
  const src = ['tools.ts', 'claude-engine.ts'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  // `kind: 'x.y'` in approval actions, plus the in-run ACTIONS executors (`  save_niche_pack: async ({`).
  const kinds = [...src.matchAll(/kind: '([a-z_]+\.[a-z_]+|tool_use)'|^ {2}(\w+): async \(\{/gm)].map((m) => (m[1] ?? m[2])!);
  expect(kinds).toContain('save_niche_pack');
  for (const k of kinds) expect(APPROVAL_KINDS[k], k).toBeDefined();
});
