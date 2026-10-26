import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_ROLES, type Agent, type AgentRole, type Niche, type NicheLearning, type Platform, type Store, type StoreMemory } from '@frontline/shared';
import { customNichePack } from './niche';
import { ROLES, SQUAD_RULES } from './roles';

const root = new URL('../', import.meta.url);

/** The owner's edit of a shipped layer (Knowledge Base): <FRONTLINE_DATA_DIR>/knowledge/<path>. */
export const editedLayerPath = (path: string) => join(process.env.FRONTLINE_DATA_DIR ?? './.data', 'knowledge', path);

/** The owner's edit of packages/agents/<path>, else the shipped file, else '' (e.g. niche 'other'). */
function layer(path: string): string {
  const edited = editedLayerPath(path);
  if (existsSync(edited)) return readFileSync(edited, 'utf8').trim();
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
  /** The store's requests still waiting for the owner, one line each, so nobody asks twice. */
  waiting?: string[];
  /** Whole-prompt token budget. */
  budget?: number;
  /** YYYY-MM-DD in the store's timezone. Defaults to now. */
  today?: string;
}

/**
 * Expertise layers: role + playbook → platform pack → niche pack → store profile → store memory.
 * Stable layers come first and volatile ones (memories, date) last, so the prompt prefix stays cacheable.
 */
export function assemblePrompt({ agent, store, memories = [], nicheLearnings = [], waiting = [], budget = 8000, today }: PromptInput): string {
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
  // The zone the store's data is dated in, as the tools' windows: a connected shop's own, demo data's this machine's.
  const zone = store.connected ? store.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = `Today is ${today ?? new Date().toLocaleDateString('en-CA', { timeZone: zone })} (${zone}).`;

  let used = estimateTokens([...fixed, date].join('\n\n'));
  const known: string[] = [];
  for (const m of memories) {
    const line = `- ${m.text}${m.evidence ? ` Evidence: ${m.evidence}.` : ''} (${m.kind}, confidence ${m.confidence.toFixed(1)})`;
    used += estimateTokens(line) + 1;
    if (used > budget) break;
    known.push(line);
  }
  const memory = known.length ? `# What the squad has learned about ${store.name}\n${known.join('\n')}` : '';
  const open = waiting.length ? `# Waiting for the owner\nAlready asked in this store; don't ask for these again:\n${waiting.map((w) => `- ${w}`).join('\n')}` : '';
  return [...fixed, memory, open, date].filter(Boolean).join('\n\n');
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
