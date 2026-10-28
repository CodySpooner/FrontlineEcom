import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { conversationState, runState, type AgentRun, type AgentRunDetail, type Conversation, type ConversationContext, type ConversationCounts, type ConversationPage, type CreativeKind, type CursorPage, type KbStage, type KnowledgeUse, type RunDeliverable, type Store } from '@frontline/shared';
import { saveConfig, type AgentType, type ConfigDraft } from './configs';
import { ftsQuery } from './kb-retrieve';
import { finalText, getRun } from './runs';

// Conversations live in `conversations` (migration #50); their runs are agent_runs rows with its id. Search goes
// through `conversations_fts`, one row per conversation, rebuilt on every write (indexConversation).

/** Creates a conversation on its own config, or returns the one a repeated `clientRequestId` made. */
export function createConversation(
  db: DatabaseSync,
  store: Store,
  type: AgentType,
  draft: ConfigDraft,
  { title, context, clientRequestId }: { title: string; context?: ConversationContext; clientRequestId?: string },
): Conversation {
  const same = clientRequestId && db.prepare('SELECT id FROM conversations WHERE store_id = ? AND client_request_id = ?').get(store.id, clientRequestId);
  if (same) return getConversation(db, String(same.id))!;
  const config = saveConfig(db, store, type, draft);
  const id = randomUUID();
  const at = new Date().toISOString();
  db.prepare(
    'INSERT INTO conversations (id, store_id, config_id, title, context_json, client_request_id, created_at, updated_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, store.id, config.id, title, context ? JSON.stringify(context) : null, clientRequestId ?? null, at, at, at);
  indexConversation(db, id);
  return getConversation(db, id)!;
}

/** Undoes a conversation whose first turn couldn't start, so a refused Deploy leaves nothing behind. */
export function discardConversation(db: DatabaseSync, id: string) {
  const configId = db.prepare('SELECT config_id FROM conversations WHERE id = ?').get(id)?.config_id;
  db.prepare('DELETE FROM conversations_fts WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  if (configId) db.prepare('DELETE FROM agent_configs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE config_id = ?)').run(String(configId), String(configId));
}

const FROM = `FROM conversations c JOIN agent_configs f ON f.id = c.config_id LEFT JOIN squad_missions m ON m.conversation_id = c.id AND m.kind = 'team'`;
const SELECT = `SELECT c.*, f.agent_id, f.custom_role_id, m.id AS team_id ${FROM}`;

export function getConversation(db: DatabaseSync, id: string): Conversation | undefined {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id);
  return r && toConversation(db, r);
}

export interface ConversationQuery {
  view?: 'active' | 'archived' | 'pinned';
  /** A role, a custom role id, or 'team'. */
  type?: string;
  /** Last activity within this many days, or still going. */
  rangeDays?: number;
  q?: string;
  cursor?: string;
  limit?: number;
}

const TYPE = `CASE WHEN m.id IS NOT NULL THEN 'team' ELSE coalesce(f.custom_role_id, substr(f.agent_id, instr(f.agent_id, ':') + 1)) END`;

/** A store's conversations, last activity first, in pages, with each type's count under the same filters. */
export function listConversations(db: DatabaseSync, storeId: string, q: ConversationQuery = {}): ConversationPage {
  const where = ['c.store_id = ?', q.view === 'archived' ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'];
  const args: (string | number)[] = [storeId];
  if (q.view === 'pinned') where.push('c.pinned = 1');
  if (q.type) where.push(`${TYPE} = ?`), args.push(q.type);
  if (q.rangeDays !== undefined) {
    where.push(`(c.last_activity_at >= ? OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.conversation_id = c.id AND r.status IN ('queued', 'running')))`);
    args.push(new Date(Date.now() - q.rangeDays * 86_400_000).toISOString());
  }
  if (q.q !== undefined) {
    const match = ftsQuery(q.q);
    if (!match) return { items: [], total: 0, byType: {} };
    where.push('c.id IN (SELECT conversation_id FROM conversations_fts WHERE conversations_fts MATCH ? AND store_id = ?)');
    args.push(match, storeId);
  }
  const byType = Object.fromEntries(db.prepare(`SELECT ${TYPE} AS type, count(*) AS n ${FROM} WHERE ${where.join(' AND ')} GROUP BY type`).all(...args).map((r) => [String(r.type), Number(r.n)]));
  const total = Object.values(byType).reduce((a, n) => a + n, 0);
  const [at, id] = q.cursor?.split('|') ?? [];
  const page = id ? [...where, '(c.last_activity_at, c.id) < (?, ?)'] : where;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const rows = db.prepare(`${SELECT} WHERE ${page.join(' AND ')} ORDER BY c.last_activity_at DESC, c.id DESC LIMIT ?`).all(...args, ...(id ? [at!, id] : []), limit + 1);
  const items = rows.slice(0, limit).map((r) => toConversation(db, r));
  const last = items.at(-1);
  return { items, total, byType, ...(rows.length > limit && last ? { next: `${last.lastActivityAt}|${last.id}` } : {}) };
}

/** Per store: conversations with a reply going or queued, and those waiting on the owner (an approval or a question). */
export function conversationCounts(db: DatabaseSync): ConversationCounts {
  const counts: ConversationCounts = {};
  const rows = db
    .prepare(
      `SELECT r.store_id, r.conversation_id, max(EXISTS (SELECT 1 FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending')) AS waiting
       FROM agent_runs r JOIN conversations c ON c.id = r.conversation_id WHERE r.status IN ('queued', 'running') GROUP BY r.store_id, r.conversation_id`,
    )
    .all();
  for (const r of rows) {
    const c = (counts[String(r.store_id)] ??= { running: 0, waiting: 0 });
    if (Number(r.waiting)) c.waiting++;
    else c.running++;
  }
  return counts;
}

/** A page of a conversation's runs, oldest first, going back from the newest. `get` adds a live run's transcript so far. */
export function conversationThread(db: DatabaseSync, id: string, { before, limit = 20 }: { before?: string; limit?: number }, get: (runId: string) => AgentRunDetail | undefined): CursorPage<AgentRunDetail> {
  const n = Math.min(100, Math.max(1, limit));
  const rows = db
    .prepare(`SELECT id, rowid FROM agent_runs WHERE conversation_id = ? ${before ? 'AND rowid < ?' : ''} ORDER BY rowid DESC LIMIT ?`)
    .all(id, ...(before ? [Number(before)] : []), n + 1);
  const total = Number(db.prepare('SELECT count(*) AS n FROM agent_runs WHERE conversation_id = ?').get(id)?.n);
  const retried = db.prepare(`SELECT ref FROM done_once WHERE ref LIKE 'retry:%:' || ?`);
  const items = rows.slice(0, n).reverse().flatMap((r) => {
    const run = get(String(r.id));
    const retryOf = run && retried.get(run.id)?.ref?.toString().split(':')[1];
    if (!run) return [];
    const deliverables = runDeliverables(db, run.id);
    return [{ ...run, state: stateOf(db, run), ...(retryOf ? { retryOf } : {}), ...(deliverables.length ? { deliverables } : {}) }];
  });
  return { items, total, ...(rows.length > n ? { next: String(rows[n - 1]!.rowid) } : {}) };
}

/** Rename, pin, archive. A team's conversation renames its team too, so the Ecosystem panel matches. */
/** "Change runtime or model…" (decision 10): the conversation moves to a new config; its next turn starts a new session. */
export function setConversationConfig(db: DatabaseSync, id: string, configId: string) {
  db.prepare('UPDATE conversations SET config_id = ?, updated_at = ? WHERE id = ?').run(configId, new Date().toISOString(), id);
}

export function updateConversation(db: DatabaseSync, id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }): Conversation | undefined {
  if (!getConversation(db, id)) return undefined;
  const at = new Date().toISOString();
  if (patch.title !== undefined) {
    db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(patch.title, id);
    db.prepare(`UPDATE squad_missions SET title = ? WHERE conversation_id = ? AND kind = 'team'`).run(patch.title, id);
  }
  if (patch.pinned !== undefined) db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
  if (patch.archived !== undefined) db.prepare('UPDATE conversations SET archived_at = ? WHERE id = ?').run(patch.archived ? at : null, id);
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(at, id);
  if (patch.title !== undefined) indexConversation(db, id);
  return getConversation(db, id);
}

/** Keeps search in step: the title, then each message and final answer. */
// ponytail: rebuilt whole on each write; append per run if long conversations make it slow.
export function indexConversation(db: DatabaseSync, id: string) {
  const c = db.prepare('SELECT title, store_id FROM conversations WHERE id = ?').get(id);
  db.prepare('DELETE FROM conversations_fts WHERE conversation_id = ?').run(id);
  if (!c) return;
  const said = db
    .prepare('SELECT task, transcript_json FROM agent_runs WHERE conversation_id = ? ORDER BY rowid')
    .all(id)
    .map((r) => `${r.task}\n${finalText(JSON.parse(String(r.transcript_json)))}`);
  db.prepare('INSERT INTO conversations_fts (title, text, store_id, conversation_id) VALUES (?, ?, ?, ?)').run(String(c.title), said.join('\n\n'), String(c.store_id), id);
}

/** A run ended (or started): the conversation's activity date and its search text follow. */
export function touchConversation(db: DatabaseSync, run: AgentRun) {
  if (!run.conversationId) return;
  db.prepare('UPDATE conversations SET last_activity_at = ? WHERE id = ?').run(new Date().toISOString(), run.conversationId);
  if (run.status === 'done' || run.status === 'error' || run.status === 'cancelled') indexConversation(db, run.conversationId);
}

/**
 * What a new session needs of earlier runs (decisions 4 and 10): the title, the objective (the first message), each
 * exchange (owner message and final answer, which ends with the agent's open questions), newest kept within the budget,
 * and the knowledge cards cited. Runs from before the store went live hold demo numbers and are left out; undefined
 * when nothing is left.
 */
export function recap(db: DatabaseSync, storeId: string, runIds: string[], title?: string): string | undefined {
  const live = db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${storeId}`)?.at;
  const runs = runIds.flatMap((id) => getRun(db, id) ?? []).filter((r) => r.storeId === storeId && (!live || r.createdAt >= String(live)));
  if (!runs.length) return undefined;
  let text = '';
  let kept = 0;
  for (const r of [...runs].reverse()) {
    const exchange = `The owner asked: ${r.task.slice(0, 2000)}\nYou answered: ${finalText(r.transcript).slice(0, 3000) || '(no answer)'}`;
    if (text && text.length + exchange.length > 6000) break;
    text = `${exchange}\n\n${text}`;
    kept++;
  }
  const objective = kept < runs.length ? `The objective, from the first message: ${runs[0]!.task.slice(0, 1000)}\n\n` : '';
  // This store's cards and General ones only: a card id from elsewhere names nothing here.
  const ids = [...new Set(runs.flatMap((r) => [...finalText(r.transcript).matchAll(/\[kb:([\w-]+)\]/g)].map((m) => m[1]!)))].slice(0, 10);
  const cards = ids.flatMap((id) => db.prepare('SELECT id, title FROM kb_cards WHERE id = ? AND (store_id = ? OR store_id IS NULL)').all(id, storeId)).map((k) => `[kb:${k.id}] ${k.title}`);
  return (
    `${title ? `This continues "${title}". ` : ''}Earlier work, from a session that has ended:\n\n${objective}${text.trim()}` +
    (cards.length ? `\n\nKnowledge cards cited: ${cards.join('; ')}.` : '')
  );
}

/**
 * What a conversation's turn in a fresh session starts from (decisions 4, 10 and 14): what it was opened from (the run it
 * continues, as a recap, or the module record, which the agent reads with its own tools rather than from a pasted copy),
 * then a recap of its own earlier turns that finished, before `before`: after "Change runtime or model…" or an expired
 * session.
 */
export function conversationPreface(db: DatabaseSync, conversationId: string, before?: string): string | undefined {
  const c = db.prepare('SELECT store_id, title, context_json FROM conversations WHERE id = ?').get(conversationId);
  if (!c) return undefined;
  const earlier = db
    .prepare(`SELECT id FROM agent_runs WHERE conversation_id = ? AND status = 'done' AND rowid < coalesce((SELECT rowid FROM agent_runs WHERE id = ?), 9e18) ORDER BY rowid`)
    .all(conversationId, before ?? null)
    .map((r) => String(r.id));
  const parts = [openedFrom(db, String(c.store_id), c.context_json ? (JSON.parse(String(c.context_json)) as ConversationContext) : undefined), earlier.length ? recap(db, String(c.store_id), earlier, String(c.title)) : undefined];
  return parts.filter(Boolean).join('\n\n') || undefined;
}

function openedFrom(db: DatabaseSync, storeId: string, context?: ConversationContext): string | undefined {
  if (context?.kind === 'run') return recap(db, storeId, [context.id]);
  if (context?.kind === 'campaign') {
    // The record from the store's own data, not what the module passed.
    const camp = db.prepare('SELECT c.name, c.status, c.daily_budget, s.currency FROM campaigns c JOIN stores s ON s.id = c.store_id WHERE c.store_id = ? AND c.network = ? AND c.id = ?').get(storeId, context.network, context.id);
    if (!camp) return `The owner opened this from the ${context.network} campaign "${context.name}" (id ${context.id}), which is no longer in the store's data.`;
    const t = db.prepare(`SELECT sum(spend) AS spend, sum(revenue) AS revenue, sum(purchases) AS purchases FROM campaign_daily WHERE network = ? AND campaign_id = ? AND date >= date('now', '-30 days')`).get(context.network, context.id);
    const money = (n: unknown) => `${Number(n ?? 0).toFixed(2)} ${camp.currency}`;
    const roas = Number(t?.spend) ? (Number(t?.revenue) / Number(t?.spend)).toFixed(2) : 'n/a';
    return (
      `The owner opened this from the ${context.network} campaign "${camp.name}" (id ${context.id}): ${camp.status}, daily budget ${money(camp.daily_budget)}; ` +
      `last 30 days spend ${money(t?.spend)}, revenue ${money(t?.revenue)}, ROAS ${roas}, ${Number(t?.purchases ?? 0)} purchases. Check the latest numbers with your tools before you act.`
    );
  }
  return undefined;
}

/** What a run made, found by run_id (decision 14): creatives, page and flow drafts, and the campaigns its ad requests are about. */
export function runDeliverables(db: DatabaseSync, runId: string): RunDeliverable[] {
  const rows = (sql: string) => db.prepare(sql).all(runId);
  return [
    ...rows('SELECT id, headline, kind FROM creatives WHERE run_id = ? ORDER BY created_at').map((r) => ({ kind: 'creative' as const, id: String(r.id), title: String(r.headline), creativeKind: r.kind as CreativeKind })),
    ...rows('SELECT id, title FROM page_drafts WHERE run_id = ? ORDER BY rowid').map((r) => ({ kind: 'page_draft' as const, id: String(r.id), title: String(r.title) })),
    ...rows('SELECT id, name FROM flow_drafts WHERE run_id = ? ORDER BY rowid').map((r) => ({ kind: 'flow_draft' as const, id: String(r.id), title: String(r.name) })),
    ...rows(
      `SELECT DISTINCT c.id, c.name FROM approvals a JOIN campaigns c ON c.store_id = a.store_id AND c.id = json_extract(a.action_json, '$.payload.campaignId')
       WHERE a.run_id = ? AND json_extract(a.action_json, '$.kind') LIKE 'ads.%'`,
    ).map((r) => ({ kind: 'campaign' as const, id: String(r.id), title: String(r.name) })),
  ];
}

/** What a conversation's turn searches knowledge by (decision 11): its title, its objective (the first message) and `message`. */
export function conversationQuery(db: DatabaseSync, conversationId: string, message: string): string {
  const c = db.prepare('SELECT title FROM conversations WHERE id = ?').get(conversationId);
  const objective = db.prepare('SELECT task FROM agent_runs WHERE conversation_id = ? ORDER BY rowid LIMIT 1').get(conversationId)?.task;
  return [...new Set([c?.title, objective, message].filter(Boolean).map((t) => String(t).slice(0, 1000)))].join('\n');
}

/** The Knowledge tab: the cards its latest started run had in its prompt, searched or cited; this store's and General's only. */
export function conversationKnowledge(db: DatabaseSync, conversationId: string): KnowledgeUse[] {
  const run = db.prepare(`SELECT id, store_id FROM agent_runs WHERE conversation_id = ? AND status != 'queued' ORDER BY rowid DESC LIMIT 1`).get(conversationId);
  if (!run) return [];
  const cards = new Map<string, KnowledgeUse>();
  const rows = db
    .prepare(`SELECT r.card_id, r.kind, k.title, k.stage, k.store_id FROM kb_retrievals r JOIN kb_cards k ON k.id = r.card_id WHERE r.run_id = ? AND (k.store_id = ? OR k.store_id IS NULL) ORDER BY r.rowid`)
    .all(String(run.id), String(run.store_id));
  for (const r of rows) {
    const id = String(r.card_id);
    const card = cards.get(id) ?? { id, title: String(r.title), stage: r.stage as KbStage, storeId: r.store_id == null ? null : String(r.store_id), how: [] };
    const how = r.kind as 'prompt' | 'search' | 'cited';
    if (!card.how.includes(how)) card.how.push(how);
    cards.set(id, card);
  }
  return [...cards.values()];
}

/** A run's state for the page (decision 5): its approvals waiting on the owner decide between approval and question. */
export function stateOf(db: DatabaseSync, run: Pick<AgentRun, 'id' | 'status' | 'error'>) {
  const pending = db.prepare(`SELECT json_extract(action_json, '$.kind') AS kind FROM approvals WHERE run_id = ? AND status = 'pending'`).all(run.id).map((r) => String(r.kind));
  return runState(run, pending);
}

function toConversation(db: DatabaseSync, r: Record<string, unknown>): Conversation {
  const id = String(r.id);
  const runs = db
    .prepare(`SELECT id, status, error FROM agent_runs WHERE conversation_id = ? AND (status IN ('queued', 'running') OR rowid = (SELECT max(rowid) FROM agent_runs WHERE conversation_id = ?)) ORDER BY rowid DESC`)
    .all(id, id)
    .map((x) => ({ id: String(x.id), status: x.status as AgentRun['status'], ...(x.error == null ? {} : { error: String(x.error) }) }));
  return {
    id,
    storeId: String(r.store_id),
    configId: String(r.config_id),
    agentId: String(r.agent_id),
    type: r.custom_role_id == null ? String(r.agent_id).split(':')[1]! : String(r.custom_role_id),
    title: String(r.title),
    ...(r.context_json == null ? {} : { context: JSON.parse(String(r.context_json)) as ConversationContext }),
    pinned: Number(r.pinned) === 1,
    ...(r.archived_at == null ? {} : { archivedAt: String(r.archived_at) }),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastActivityAt: String(r.last_activity_at),
    state: conversationState(runs.map((x) => stateOf(db, x))),
    ...(r.team_id == null ? {} : { teamId: String(r.team_id) }),
  };
}
