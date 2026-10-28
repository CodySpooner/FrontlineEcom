import { registryModels, type Store } from '@frontline/shared';
import { expect, test } from 'vitest';
import { claudeRuntime, defaultTools, seatDefault, validateConfig, type AgentType } from './index';

const demo: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#ff8f98', connected: false };
const type: AgentType = { role: 'copywriter', tools: defaultTools('copywriter') };
const opus = { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', default: true };
const haiku = { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [], effortsFromRegistry: true };
const signedIn = claudeRuntime({ signedIn: true, email: 'o@x.com', checkedAt: 'now', models: [opus, haiku] });
const check = (input: object, caps = [signedIn], store = demo) => validateConfig(store, type, input, caps);

test("a config is checked against the login's discovered models and their efforts", () => {
  expect(check({})).toMatchObject({ runtime: 'demo' }); // a demo store's default
  expect(check({})).not.toHaveProperty('model');
  // The owner may pick Claude on a demo store: the default model at its default effort, or what they chose.
  expect(check({ runtime: 'claude' })).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' });
  expect(check({ runtime: 'claude', effort: 'max', permissions: { budgetUsd: 2 } })).toMatchObject({ effort: 'max', permissions: { budgetUsd: 2 } });
  expect(check({ runtime: 'claude', model: 'claude-haiku-4-5-20251001' })).not.toHaveProperty('effort'); // takes none
  expect(check({ runtime: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'low' })).toEqual({ field: 'effort', error: 'Haiku 4.5 takes no effort level: leave it out.' });
  expect(check({ runtime: 'claude', effort: 'ultra' })).toEqual({ field: 'effort', error: 'Opus 5.5 runs at Low, Medium, High, Extra high, Max.' });
  expect(check({ runtime: 'claude', model: 'claude-sonnet-5-5' })).toEqual({ field: 'model', error: `"claude-sonnet-5-5" isn't on your Claude login's model list.` });
  expect(check({ runtime: 'claude', model: 'sonnet' })).toMatchObject({ field: 'model' }); // aliases move: only resolved ids
  expect(check({ model: 'claude-opus-5-5' })).toEqual({ field: 'model', error: 'Demo (free) has no model or effort to choose.' });
  expect(check({ permissions: { budgetUsd: 2 } })).toMatchObject({ field: 'permissions.budgetUsd' });
  expect(check({ runtime: 'codex' })).toMatchObject({ field: 'runtime' });
  expect(check({ runtime: 'gpt' })).toMatchObject({ field: 'runtime' });
});

test("Claude signed out is refused with what to do; a check that failed falls back to the registry, flagged", () => {
  const signedOut = claudeRuntime({ signedIn: false, checkedAt: 'now' });
  expect(check({ runtime: 'claude' }, [signedOut])).toEqual({ field: 'runtime', error: 'Sign in to Claude Code: open a terminal, run `claude` and sign in with /login.' });
  expect(check({ runtime: 'claude' }, [])).toMatchObject({ field: 'runtime' });
  const down = claudeRuntime({ signedIn: false, checkedAt: 'now', error: "Claude Code didn't answer in 30 s." });
  expect(down).toMatchObject({ connected: false, source: 'registry', registryVersion: '2026-10-28', models: registryModels() });
  expect(down).not.toHaveProperty('reason');
  expect(check({ runtime: 'claude', model: 'claude-sonnet-5-5' }, [down])).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'medium' });
  expect(claudeRuntime({ signedIn: false, checkedAt: 'now', error: 'x' }, 'Agents are set to the demo engine here.').reason).toBe('Agents are set to the demo engine here.');
  expect(signedIn).toMatchObject({ connected: true, account: 'o@x.com', source: 'discovered', registryVersion: '2026-10-28' }); // Haiku 4.5's efforts came from it
});

test("a store whose agents run on Claude defaults to the login's default model at its default effort; Demo isn't offered there", () => {
  const forced = process.env.FRONTLINE_AGENT_ENGINE;
  process.env.FRONTLINE_AGENT_ENGINE = 'claude'; // what a connected store gets; nothing runs here
  try {
    const live = { ...demo, connected: true };
    expect(seatDefault(live, type, signedIn)).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' });
    expect(seatDefault(live, type)).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' }); // no check yet: the registry's
    expect(check({}, [signedIn], live)).toMatchObject({ runtime: 'claude', model: 'claude-opus-5-5', effort: 'medium' });
    expect(check({ runtime: 'demo' }, [signedIn], live)).toEqual({ field: 'runtime', error: 'Demo (free) is only for stores with demo data.' });
  } finally {
    process.env.FRONTLINE_AGENT_ENGINE = forced;
  }
});
