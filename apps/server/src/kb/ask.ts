// "Ask the knowledge base" (KB-24): the cards matching a question in the owner's scope, grouped by what backs them, and
// the task for the agent run that answers from them only. Retrieval is the agents' own (keyword, metadata and links,
// decision 12) as a Market Analyst gets it, so blocked, unreviewed and archived cards never reach an answer.
import { retrieveKnowledge } from '@frontline/agents';
import { KB_STAGES, type KbAskAnswer, type KbAskCard, type KbCard, type KbSourceBrief, type KbSourceReliability, type KbSourceStatus, type KbWorkspace } from '@frontline/shared';
import type { Db } from '../db';
import { listStores } from '../stores';

const LIMIT = 12;

/** The best matching cards: a store's and General's, General's alone, or each store's own best few and then General's. */
function matching(db: Db, ws: KbWorkspace | 'all', question: string): KbCard[] {
  const find = (w: KbWorkspace, limit: number) => retrieveKnowledge(db, { ws: w, role: 'market_analyst', query: question, limit });
  if (ws !== 'all') return find(ws, LIMIT);
  const own = listStores(db).flatMap((s) => find(s.id, LIMIT).filter((c) => c.storeId === s.id).slice(0, 4));
  return [...own, ...find(null, 4)];
}

function sourcesOf(db: Db, cardId: string): KbSourceBrief[] {
  return db
    .prepare(`SELECT DISTINCT s.id, s.url, s.title, s.status, s.reliability, s.fetched_at FROM kb_evidence e JOIN kb_sources s ON s.id = e.source_id WHERE e.card_id = ? ORDER BY lower(s.title), s.id`)
    .all(cardId)
    .map((r) => ({
      id: String(r.id),
      ...(r.url ? { url: String(r.url) } : {}),
      title: String(r.title),
      status: r.status as KbSourceStatus,
      reliability: r.reliability as KbSourceReliability,
      ...(r.fetched_at ? { fetchedAt: String(r.fetched_at) } : {}),
    }));
}

/** The answer's cards, and with any, the task for the agent that writes it. */
export function askKnowledge(db: Db, ws: KbWorkspace | 'all', question: string): { answer: KbAskAnswer; task?: string } {
  const answer: KbAskAnswer = { measured: [], research: [], unproven: [] };
  for (const card of matching(db, ws, question)) {
    const kinds = new Set(db.prepare('SELECT kind FROM kb_evidence WHERE card_id = ?').all(card.id).map((r) => String(r.kind)));
    answer[kinds.has('measured') ? 'measured' : kinds.has('research') ? 'research' : 'unproven'].push({ card, sources: sourcesOf(db, card.id) });
  }
  const cards = [...answer.measured, ...answer.research, ...answer.unproven];
  if (!cards.length) return { answer };
  const store = new Map(listStores(db).map((s) => [s.id, s.name]));
  const line = ({ card: c, sources }: KbAskCard) =>
    `- [kb:${c.id}] ${c.title} (${c.storeId ? (store.get(c.storeId) ?? c.storeId) : 'General'}, ${KB_STAGES[c.stage]})${c.summary ? `: ${c.summary.replace(/\.$/, '')}` : ''}${
      sources.length ? `. Sources: ${sources.map((s) => `"${s.title || s.url}"`).join('; ')}` : ''
    }`;
  const part = (title: string, xs: KbAskCard[]) => [title, ...(xs.length ? xs.map(line) : ['(none)'])];
  const task = [
    `The owner asks the knowledge base: "${question}"`,
    ...(ws === 'all' ? ['The cards come from every store and General: compare them, and say which store each finding is from.'] : []),
    "Answer from the cards below only, not from what you know otherwise. Put conclusions the stores' own numbers back under " +
      '"Measured" and recommendations from read sources under "Research", and say what only a hypothesis backs. Cite each card ' +
      `you use as [kb:<id>] and its sources by title. If they don't answer it, say plainly that the knowledge base doesn't know yet, ` +
      'and what research would find out.',
    '',
    ...part("Measured (the stores' own numbers):", answer.measured),
    ...part('Research (read sources):', answer.research),
    ...part('Unproven (hypotheses: nothing backs them yet):', answer.unproven),
  ].join('\n');
  return { answer, task };
}
