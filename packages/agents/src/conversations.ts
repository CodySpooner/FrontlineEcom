import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { conversationState, runState, type AgentRun, type AgentRunDetail, type Conversation, type ConversationContext, type CursorPage, type Store } from '@frontline/shared';
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

const SELECT = `SELECT c.*, f.agent_id, f.custom_role_id, m.id AS team_id FROM conversations c JOIN agent_configs f ON f.id = c.config_id
  LEFT JOIN squad_missions m ON m.conversation_id = c.id AND m.kind = 'team'`;

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

/** A store's conversations, last activity first, in pages. */
export function listConversations(db: DatabaseSync, storeId: string, q: ConversationQuery = {}): CursorPage<Conversation> {
  const where = ['c.store_id = ?', q.view === 'archived' ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL'];
  const args: (string | number)[] = [storeId];
  if (q.view === 'pinned') where.push('c.pinned = 1');
  if (q.type === 'team') where.push('m.id IS NOT NULL');
  else if (q.type) where.push(`m.id IS NULL AND coalesce(f.custom_role_id, substr(f.agent_id, instr(f.agent_id, ':') + 1)) = ?`), args.push(q.type);
  if (q.rangeDays !== undefined) {
    where.push(`(c.last_activity_at >= ? OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.conversation_id = c.id AND r.status IN ('queued', 'running')))`);
    args.push(new Date(Date.now() - q.rangeDays * 86_400_000).toISOString());
  }
  if (q.q !== undefined) {
    const match = ftsQuery(q.q);
    if (!match) return { items: [], total: 0 };
    where.push('c.id IN (SELECT conversation_id FROM conversations_fts WHERE conversations_fts MATCH ? AND store_id = ?)');
    args.push(match, storeId);
  }
  const total = Number(db.prepare(`SELECT count(*) AS n FROM (${SELECT} WHERE ${where.join(' AND ')})`).get(...args)?.n);
  const [at, id] = q.cursor?.split('|') ?? [];
  const page = id ? [...where, '(c.last_activity_at, c.id) < (?, ?)'] : where;
  const limit = Math.min(100, Math.max(1, q.limit ?? 50));
  const rows = db.prepare(`${SELECT} WHERE ${page.join(' AND ')} ORDER BY c.last_activity_at DESC, c.id DESC LIMIT ?`).all(...args, ...(id ? [at!, id] : []), limit + 1);
  const items = rows.slice(0, limit).map((r) => toConversation(db, r));
  const last = items.at(-1);
  return { items, total, ...(rows.length > limit && last ? { next: `${last.lastActivityAt}|${last.id}` } : {}) };
}

/** A page of a conversation's runs, oldest first, going back from the newest. `get` adds a live run's transcript so far. */
export function conversationThread(db: DatabaseSync, id: string, { before, limit = 20 }: { before?: string; limit?: number }, get: (runId: string) => AgentRunDetail | undefined): CursorPage<AgentRunDetail> {
  const n = Math.min(100, Math.max(1, limit));
  const rows = db
    .prepare(`SELECT id, rowid FROM agent_runs WHERE conversation_id = ? ${before ? 'AND rowid < ?' : ''} ORDER BY rowid DESC LIMIT ?`)
    .all(id, ...(before ? [Number(before)] : []), n + 1);
  const total = Number(db.prepare('SELECT count(*) AS n FROM agent_runs WHERE conversation_id = ?').get(id)?.n);
  const items = rows.slice(0, n).reverse().flatMap((r) => {
    const run = get(String(r.id));
    return run ? [{ ...run, state: stateOf(db, run) }] : [];
  });
  return { items, total, ...(rows.length > n ? { next: String(rows[n - 1]!.rowid) } : {}) };
}

/** Rename, pin, archive. A team's conversation renames its team too, so the Ecosystem panel matches. */
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
 * What a new session needs of earlier runs (decisions 4 and 10): the title and each exchange, owner message and final
 * answer, newest kept within the budget. Runs from before the store went live hold demo numbers and are left out;
 * undefined when nothing is left.
 */
// ponytail: exchanges only; the cards cited and open questions join when "Change runtime or model" needs them (AA-14b).
export function recap(db: DatabaseSync, storeId: string, runIds: string[], title?: string): string | undefined {
  const live = db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${storeId}`)?.at;
  const runs = runIds.flatMap((id) => getRun(db, id) ?? []).filter((r) => r.storeId === storeId && (!live || r.createdAt >= String(live)));
  if (!runs.length) return undefined;
  let text = '';
  for (const r of runs.reverse()) {
    const exchange = `The owner asked: ${r.task.slice(0, 2000)}\nYou answered: ${finalText(r.transcript).slice(0, 3000) || '(no answer)'}`;
    if (text && text.length + exchange.length > 6000) break;
    text = `${exchange}\n\n${text}`;
  }
  return `${title ? `This continues "${title}". ` : ''}Earlier work, from a session that has ended:\n\n${text.trim()}`;
}

/**
 * What a conversation's first turn in a fresh session starts from: the run it continues (a recap), or the module record
 * it was opened from, which the agent reads with its own tools rather than from a pasted copy (decision 14).
 */
export function conversationPreface(db: DatabaseSync, conversationId: string): string | undefined {
  const c = db.prepare('SELECT store_id, context_json FROM conversations WHERE id = ?').get(conversationId);
  const context = c?.context_json ? (JSON.parse(String(c.context_json)) as ConversationContext) : undefined;
  if (context?.kind === 'run') return recap(db, String(c!.store_id), [context.id]);
  if (context?.kind === 'campaign') return `The owner opened this from the ${context.network} campaign "${context.name}" (id ${context.id}). Read its numbers with your tools.`;
  return undefined;
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
