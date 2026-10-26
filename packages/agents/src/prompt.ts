import { existsSync, readFileSync } from 'node:fs';
import { AGENT_ROLES, type Agent, type AgentRole, type Niche, type NicheLearning, type Platform, type Store, type StoreMemory } from '@frontline/shared';
import { customNichePack } from './niche';
import { ROLES, SQUAD_RULES } from './roles';

const root = new URL('../', import.meta.url);

/** Contents of packages/agents/<path>, or '' when that layer doesn't exist (e.g. niche 'other'). */
function layer(path: string): string {
  const url = new URL(path, root);
  return existsSync(url) ? readFileSync(url, 'utf8').trim() : '';
}

export const playbook = (role: AgentRole) => layer(`playbooks/${role}.md`);
export const platformPack = (platform: Platform) => layer(`packs/platform/${platform}.md`);
export const nichePack = (niche: Niche) => layer(`packs/niche/${niche}.md`);

// ponytail: chars/4 heuristic, swap for the SDK token counter if budgets get tight.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export interface PromptInput {
  agent: Agent;
  store: Store;
  /** Ranked best-first. The tail is dropped to fit the budget; the other layers always stay. */
  memories?: StoreMemory[];
  /** Owner-approved learnings shared across the store's niche. */
  nicheLearnings?: NicheLearning[];
  /** Whole-prompt token budget. */
  budget?: number;
  /** YYYY-MM-DD in the store's timezone. Defaults to now. */
  today?: string;
}

/**
 * Expertise layers: role + playbook → platform pack → niche pack → store profile → store memory.
 * Stable layers come first and volatile ones (memories, date) last, so the prompt prefix stays cacheable.
 */
export function assemblePrompt({ agent, store, memories = [], nicheLearnings = [], budget = 8000, today }: PromptInput): string {
  const role = ROLES[agent.role];
  const fixed = [
    `You are the ${AGENT_ROLES[agent.role].name} of ${store.name}, a ${store.niche} store on ${store.platform}.`,
    role.prompt,
    `You are measured on ${role.kpi}.`,
    SQUAD_RULES,
    playbook(agent.role),
    platformPack(store.platform),
    nichePack(store.niche) || customNichePack(store.nicheDetail),
    nicheLearnings.length
      ? [`# Learned across ${store.niche === 'other' ? store.nicheDetail : store.niche} stores (owner-approved)`, ...nicheLearnings.map((l) => `- ${l.text}${l.evidence ? ` Evidence: ${l.evidence}.` : ''}`)].join('\n')
      : '',
    storeProfile(store),
  ].filter(Boolean);
  const date = `Today is ${today ?? new Date().toLocaleDateString('en-CA', { timeZone: store.timezone })} (${store.timezone}).`;

  let used = estimateTokens([...fixed, date].join('\n\n'));
  const known: string[] = [];
  for (const m of memories) {
    const line = `- ${m.text}${m.evidence ? ` Evidence: ${m.evidence}.` : ''} (${m.kind}, confidence ${m.confidence.toFixed(1)})`;
    used += estimateTokens(line) + 1;
    if (used > budget) break;
    known.push(line);
  }
  const memory = known.length ? `# What the squad has learned about ${store.name}\n${known.join('\n')}` : '';
  return [...fixed, memory, date].filter(Boolean).join('\n\n');
}

function storeProfile(store: Store): string {
  return [
    '# Store profile',
    `- ${store.name} (id ${store.id}) on ${store.platform}, niche ${store.niche}${store.nicheDetail ? `: ${store.nicheDetail}` : ''}`,
    `- Currency ${store.currency}, timezone ${store.timezone}`,
    store.connected
      ? '- Live data from the connected store and ad accounts.'
      : '- Demo data: no live store is connected, numbers are simulated. Say so if the owner treats them as real.',
  ].join('\n');
}
