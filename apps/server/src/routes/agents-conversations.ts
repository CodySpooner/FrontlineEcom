import { agentTypes, conversationCounts, conversationThread, createConversation, discardConversation, getConfig, getConversation, getRun, toolGroups, listConversations, recap, resolveType, updateConversation, validateConfig, type RunManager } from '@frontline/agents';
import { INTERRUPTED, type AgentRun, type Conversation, type ConversationContext, type CreateConversationInput, type SendMessageInput, type Store } from '@frontline/shared';
import { Hono, type Context } from 'hono';
import type { Db } from '../db';
import { getStore } from '../stores';

const isText = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);
/** A message: the composer's text (attachments arrive with decision 11). */
const MESSAGE_MAX = 20_000;
const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length <= 80 ? line : `${line.slice(0, 79).replace(/\s+\S*$/, '')}…`;
};

type Opened = { conversation: Conversation; run: AgentRun; repeated: boolean } | { status: 400 | 404 | 409; error: string; field?: string };

/**
 * Opens a conversation in `store` and starts its first turn: Deploy, startConversation, Continue in a new conversation
 * and the legacy run route all come here. A repeated clientRequestId returns what the first request opened. A refusal
 * leaves nothing behind.
 */
export function openConversation(db: Db, runs: RunManager, store: Store, input: CreateConversationInput): Opened {
  const same = db.prepare('SELECT c.id, r.id AS run_id FROM conversations c JOIN agent_runs r ON r.conversation_id = c.id AND r.client_request_id = c.client_request_id WHERE c.store_id = ? AND c.client_request_id = ?').get(store.id, input.clientRequestId);
  if (same) return { conversation: getConversation(db, String(same.id))!, run: getRun(db, String(same.run_id))!, repeated: true };
  let typeId = input.type;
  let { title, context } = input;
  if (input.fromRunId) {
    // Continue in a new conversation: the run's own store and seat, never the page's.
    const from = getRun(db, input.fromRunId);
    if (!from || from.storeId !== store.id) return { status: 404, error: 'Run not found' };
    if (from.conversationId) return { status: 409, error: 'That run is in a conversation already: continue there.' };
    if (from.task.includes('The cards come from every store and General') || from.transcript.some((e) => e.type === 'tool_call' && /(^|__)compare_stores$/.test(e.name))) {
      return { status: 409, error: "That run read other stores' data, so it can't continue in one store's conversation." };
    }
    if (!recap(db, store.id, [from.id])) return { status: 409, error: 'That conversation ran on demo data, before the store went live: start a new one.' };
    typeId = from.agentId.split(':')[1]!;
    title ??= firstLine(from.task);
    context = { kind: 'run', id: from.id, name: firstLine(from.task) };
  } else if (context) {
    const c = context as Partial<Extract<ConversationContext, { kind: 'campaign' }>>;
    if (c.kind !== 'campaign' || !isText(c.network, 1, 40) || !isText(c.id, 1, 200) || !isText(c.name, 1, 200)) return { status: 400, error: 'context must be { kind: campaign, network, id, name }', field: 'context' };
    // The reference must be this store's own record (decision 14).
    if (!db.prepare('SELECT 1 FROM campaigns WHERE store_id = ? AND network = ? AND id = ?').get(store.id, c.network, c.id)) return { status: 404, error: 'Campaign not found' };
  }
  const type = typeId ? resolveType(db, store.id, typeId) : undefined;
  if (!type) return { status: 404, error: 'Agent type not found' };
  const draft = validateConfig(store, type, input.config);
  if ('field' in draft) return { status: 400, ...draft };
  const conversation = createConversation(db, store, type, draft, { title: title?.trim() || firstLine(input.message), ...(context ? { context } : {}), clientRequestId: input.clientRequestId });
  const run = runs.start(conversation.agentId, input.message.trim(), undefined, undefined, { conversationId: conversation.id, clientRequestId: input.clientRequestId });
  if (typeof run === 'string') {
    discardConversation(db, conversation.id);
    return { status: 409, error: run };
  }
  return { conversation: getConversation(db, conversation.id)!, run, repeated: false };
}

/** Conversations (shared `CreateConversationInput` lists the routes). Each takes `?store=`; another store's record is a 404. */
export function conversationRoutes(db: Db, runs: RunManager) {
  const mine = (c: Context) => {
    const conversation = getConversation(db, c.req.param('id')!);
    return conversation && conversation.storeId === c.req.query('store') ? conversation : undefined;
  };
  const missing = (c: Context, what = 'Conversation') => c.json({ error: `${what} not found` }, 404);
  /** A run of this conversation, for Retry and Resume, and the request id the owner's click carries. */
  const turn = async (c: Context) => {
    const conversation = mine(c);
    const run = conversation && getRun(db, c.req.param('runId')!);
    const body = (await c.req.json().catch(() => null)) as { clientRequestId?: unknown } | null;
    return { conversation, run: run?.conversationId === conversation?.id ? run : undefined, clientRequestId: body?.clientRequestId };
  };
  const started = (c: Context, run: AgentRun | string) => (typeof run === 'string' ? c.json({ error: run }, 409) : c.json(run, 201));
  return new Hono()
    .get('/api/conversations', (c) => {
      const store = c.req.query('store');
      if (!store || !getStore(db, store)) return missing(c, 'Store');
      const [view = 'active', range] = [c.req.query('view'), c.req.query('range')];
      if (view !== 'active' && view !== 'archived' && view !== 'pinned') return c.json({ error: 'view must be active, archived or pinned' }, 400);
      if (range !== undefined && !(Number(range) > 0)) return c.json({ error: 'range must be a number of days' }, 400);
      const [type, q, cursor] = [c.req.query('type'), c.req.query('q'), c.req.query('cursor')];
      return c.json(
        listConversations(db, store, { view, ...(type ? { type } : {}), ...(range ? { rangeDays: Number(range) } : {}), ...(q?.trim() ? { q } : {}), ...(cursor ? { cursor } : {}), limit: Number(c.req.query('limit')) || 50 }),
      );
    })
    .post('/api/conversations', async (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      if (!store) return missing(c, 'Store');
      const b = (await c.req.json().catch(() => null)) as CreateConversationInput | null;
      if (!b || !isId(b.clientRequestId) || !isText(b.message, 1, MESSAGE_MAX) || (b.title !== undefined && !isText(b.title, 1, 200)) || !b.type === !b.fromRunId) {
        return c.json({ error: `Expected { clientRequestId, message (1–${MESSAGE_MAX.toLocaleString('en')} chars), type or fromRunId, title?, context?, config? }` }, 400);
      }
      const opened = openConversation(db, runs, store, b);
      if ('status' in opened) return c.json({ error: opened.error, ...(opened.field ? { field: opened.field } : {}) }, opened.status);
      return c.json({ conversation: opened.conversation, run: opened.run }, opened.repeated ? 200 : 201);
    })
    .get('/api/conversations/counts', (c) => c.json(conversationCounts(db)))
    .get('/api/agent-types', (c) => {
      const store = c.req.query('store');
      return store && getStore(db, store) ? c.json(agentTypes(db, store)) : missing(c, 'Store');
    })
    .get('/api/conversations/:id', (c) => {
      const conversation = mine(c);
      return conversation ? c.json({ ...conversation, config: getConfig(db, conversation.configId) }) : missing(c);
    })
    .get('/api/conversations/:id/tools', (c) => {
      const conversation = mine(c);
      return conversation ? c.json(toolGroups(db, getConfig(db, conversation.configId)!)) : missing(c);
    })
    .get('/api/conversations/:id/thread', (c) => {
      const conversation = mine(c);
      if (!conversation) return missing(c);
      const before = c.req.query('before');
      return c.json(conversationThread(db, conversation.id, { ...(before ? { before } : {}), limit: Number(c.req.query('limit')) || 20 }, runs.get));
    })
    .patch('/api/conversations/:id', async (c) => {
      const conversation = mine(c);
      if (!conversation) return missing(c);
      const b = (await c.req.json().catch(() => null)) as { title?: unknown; pinned?: unknown; archived?: unknown } | null;
      if (!b || (b.title !== undefined && !isText(b.title, 1, 200)) || (b.pinned !== undefined && typeof b.pinned !== 'boolean') || (b.archived !== undefined && typeof b.archived !== 'boolean')) {
        return c.json({ error: 'Expected { title?: 1–200 chars, pinned?: boolean, archived?: boolean }' }, 400);
      }
      return c.json(updateConversation(db, conversation.id, { ...(b.title !== undefined ? { title: (b.title as string).trim() } : {}), ...(b.pinned !== undefined ? { pinned: b.pinned as boolean } : {}), ...(b.archived !== undefined ? { archived: b.archived as boolean } : {}) }));
    })
    .post('/api/conversations/:id/messages', async (c) => {
      const conversation = mine(c);
      if (!conversation) return missing(c);
      const b = (await c.req.json().catch(() => null)) as SendMessageInput | null;
      if (!b || !isId(b.clientRequestId) || !isText(b.message, 1, MESSAGE_MAX)) return c.json({ error: `Expected { clientRequestId, message (1–${MESSAGE_MAX.toLocaleString('en')} chars) }` }, 400);
      return started(c, runs.start(conversation.agentId, b.message.trim(), undefined, undefined, { conversationId: conversation.id, clientRequestId: b.clientRequestId }));
    })
    .post('/api/conversations/:id/runs/:runId/retry', async (c) => {
      const { conversation, run, clientRequestId } = await turn(c);
      if (!conversation || !run) return missing(c, 'Run');
      if (!isId(clientRequestId)) return c.json({ error: 'Expected { clientRequestId }' }, 400);
      if (run.status === 'queued' || run.status === 'running') return c.json({ error: 'That reply is still going.' }, 409);
      if (run.error === INTERRUPTED) return c.json({ error: 'That reply was cut off by an app restart: resume it.' }, 409);
      return started(c, runs.start(conversation.agentId, run.task, undefined, undefined, { conversationId: conversation.id, retryOf: run.id, clientRequestId }));
    })
    .post('/api/conversations/:id/runs/:runId/resume', async (c) => {
      const { conversation, run, clientRequestId } = await turn(c);
      if (!conversation || !run) return missing(c, 'Run');
      if (!isId(clientRequestId)) return c.json({ error: 'Expected { clientRequestId }' }, 400);
      if (run.error !== INTERRUPTED) return c.json({ error: 'Only a reply cut off by an app restart can be resumed.' }, 409);
      return started(c, runs.start(conversation.agentId, run.task, undefined, undefined, { conversationId: conversation.id, retryOf: run.id, clientRequestId }));
    })
    .post('/api/conversations/:id/stop', async (c) => {
      const conversation = mine(c);
      if (!conversation) return missing(c);
      const b = (await c.req.json().catch(() => null)) as { runId?: unknown } | null;
      // The reply that is going, or a queued message the owner takes back.
      const target =
        typeof b?.runId === 'string'
          ? db.prepare(`SELECT id FROM agent_runs WHERE id = ? AND conversation_id = ? AND status IN ('queued', 'running')`).get(b.runId, conversation.id)
          : db.prepare(`SELECT id FROM agent_runs WHERE conversation_id = ? AND status = 'running' ORDER BY rowid DESC`).get(conversation.id);
      if (!target) return c.json({ error: 'Nothing is running in this conversation.' }, 409);
      return c.json(runs.cancel(String(target.id)));
    });
}
