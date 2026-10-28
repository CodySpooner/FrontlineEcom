import {
  agentTypes, archiveCustomRole, captureFinding, conversationCounts, conversationFindings, conversationKnowledge, conversationThread, createConversation, createCustomRole, discardConversation, getConfig, getConversation, getCustomRole, getRun, toolGroups, listConversations, listPresets,
  recap, replyBlocks, resolveType, saveConfig, savePreset, setConversationConfig, updateConversation, validateConfig, validateCustomRole, type RunManager,
} from '@frontline/agents';
import { ATTACHMENT_TEXT, blockFinding, INTERRUPTED, type AgentRun, type FindingSaved, type SaveFindingInput, type Conversation, type ConversationContext, type CreateConversationInput, type RunAttachment, type RuntimeCapabilities, type SendMessageInput, type Store } from '@frontline/shared';
import { Hono, type Context } from 'hono';
import { decide, getApproval } from '../approvals';
import type { Db } from '../db';
import { readUpload } from '../kb/fetcher';
import { getStore } from '../stores';
import { runtimes } from './agents-runtimes';

const isText = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{8,64}$/.test(v);
/** A message: the composer's text (attachments arrive with decision 11). */
const MESSAGE_MAX = 20_000;
const firstLine = (text: string) => {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length <= 80 ? line : `${line.slice(0, 79).replace(/\s+\S*$/, '')}…`;
};

type Opened = { conversation: Conversation; run: AgentRun; repeated: boolean } | { status: 400 | 404 | 409; error: string; field?: string };

const DOCUMENTS = ['pdf', 'txt', 'md', 'csv', 'html'];
const ATTACHMENTS_MAX = 10 * 1_048_576;

/**
 * A message's documents (decision 11), read with the knowledge base's reader. The text is kept on the run, the file
 * isn't, and nothing goes to kb_sources. A string is why they were refused.
 */
export async function readAttachments(list: unknown): Promise<RunAttachment[] | string> {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 10 || list.some((a) => !isText(a?.name, 1, 200) || typeof a?.data !== 'string')) return 'Expected attachments: up to 10 of { name, data (base64) }';
  const files = list.map((a: { name: string; data: string }) => ({ name: a.name.trim(), bytes: Buffer.from(a.data, 'base64') }));
  if (files.reduce((n, f) => n + f.bytes.length, 0) > ATTACHMENTS_MAX) return 'Attachments are up to 10 MB in total per message.';
  const read: RunAttachment[] = [];
  for (const f of files) {
    const type = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : '';
    if (!DOCUMENTS.includes(type)) return `${f.name}: attach a PDF, TXT, MD, CSV or HTML file. Images aren't supported yet.`;
    const doc = await readUpload(f.name, f.bytes, ATTACHMENTS_MAX);
    if (doc.status !== 'read' || !doc.text?.trim()) return `${f.name}: ${(doc.error ?? 'it has no readable text').replace(/\.$/, '')}.`;
    read.push({ name: f.name, type, size: f.bytes.length, text: doc.text.slice(0, ATTACHMENT_TEXT), ...(doc.text.length > ATTACHMENT_TEXT ? { cut: true } : {}) });
  }
  return read;
}

/**
 * Opens a conversation in `store` and starts its first turn: Deploy, startConversation, Continue in a new conversation
 * and the legacy run route all come here. A repeated clientRequestId returns what the first request opened. A refusal
 * leaves nothing behind. `caps`: GET /api/runtimes, what the config is checked against.
 */
export function openConversation(db: Db, runs: RunManager, store: Store, input: CreateConversationInput, caps: RuntimeCapabilities[], attachments: RunAttachment[] = []): Opened {
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
  const draft = validateConfig(store, type, input.config, caps);
  if ('field' in draft) return { status: 400, ...draft };
  const conversation = createConversation(db, store, type, draft, { title: title?.trim() || firstLine(input.message), ...(context ? { context } : {}), clientRequestId: input.clientRequestId });
  const run = runs.start(conversation.agentId, input.message.trim(), undefined, undefined, { conversationId: conversation.id, clientRequestId: input.clientRequestId, attachments });
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
      const attachments = await readAttachments(b.attachments);
      if (typeof attachments === 'string') return c.json({ error: attachments, field: 'attachments' }, 400);
      const opened = openConversation(db, runs, store, b, await runtimes(), attachments);
      if ('status' in opened) return c.json({ error: opened.error, ...(opened.field ? { field: opened.field } : {}) }, opened.status);
      return c.json({ conversation: opened.conversation, run: opened.run }, opened.repeated ? 200 : 201);
    })
    .get('/api/conversations/counts', (c) => c.json(conversationCounts(db)))
    .get('/api/agent-types', (c) => {
      const store = c.req.query('store');
      return store && getStore(db, store) ? c.json(agentTypes(db, store)) : missing(c, 'Store');
    })
    // Custom roles and presets (decision 2): a store's own or every store's; another store's is a 404 (decision 13).
    .post('/api/custom-roles', async (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      if (!store) return missing(c, 'Store');
      const role = validateCustomRole(await c.req.json().catch(() => null));
      return 'error' in role ? c.json(role, 400) : c.json(createCustomRole(db, store.id, role), 201);
    })
    .patch('/api/custom-roles/:id', async (c) => {
      const role = getCustomRole(db, c.req.query('store') ?? '', c.req.param('id'));
      if (!role) return missing(c, 'Custom role');
      const b = (await c.req.json().catch(() => null)) as { archived?: unknown } | null;
      if (typeof b?.archived !== 'boolean') return c.json({ error: 'Expected { archived: boolean }' }, 400);
      return c.json(archiveCustomRole(db, role.id, b.archived));
    })
    .get('/api/presets', (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      const presets = store && listPresets(db, store.id, c.req.query('type') ?? '');
      return presets ? c.json(presets) : missing(c, store ? 'Agent type' : 'Store');
    })
    .post('/api/presets', async (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      if (!store) return missing(c, 'Store');
      const saved = savePreset(db, store, await c.req.json().catch(() => null), await runtimes());
      return 'status' in saved ? c.json({ error: saved.error, ...(saved.field ? { field: saved.field } : {}) }, saved.status) : c.json(saved, 201);
    })
    .get('/api/conversations/:id', (c) => {
      const conversation = mine(c);
      return conversation ? c.json({ ...conversation, config: getConfig(db, conversation.configId) }) : missing(c);
    })
    // A type's tools for Deploy, with what each needs connected (the conversation's own are below).
    .get('/api/tool-groups', (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      const type = store && resolveType(db, store.id, c.req.query('type') ?? '');
      return type ? c.json(toolGroups(db, { storeId: store.id, tools: type.tools })) : missing(c, 'Agent type');
    })
    // "Change runtime or model…" (decision 10): a new config with the same tools, knowledge and limits; the next turn
    // starts a new session from the conversation's recap, and the thread shows the handoff.
    .post('/api/conversations/:id/config', async (c) => {
      const conversation = mine(c);
      const store = conversation && getStore(db, conversation.storeId);
      const type = conversation && resolveType(db, conversation.storeId, conversation.type);
      if (!conversation || !store || !type) return missing(c);
      const b = (await c.req.json().catch(() => null)) as { runtime?: unknown; model?: unknown; effort?: unknown; stopAfterMin?: unknown } | null;
      if (!b || typeof b !== 'object' || b.runtime === undefined) return c.json({ error: 'Expected { runtime, model?, effort?, stopAfterMin? }' }, 400);
      if (['running', 'queued', 'awaiting_approval', 'waiting_for_input'].includes(conversation.state)) return c.json({ error: 'Wait for the reply to finish, or stop it, before changing the runtime or model.' }, 409);
      const live = db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${store.id}`)?.at;
      if (live && !db.prepare('SELECT 1 FROM agent_runs WHERE conversation_id = ? AND created_at >= ?').get(conversation.id, String(live))) {
        return c.json({ error: 'That conversation ran on demo data, before the store went live: start a new one.' }, 409);
      }
      const old = getConfig(db, conversation.configId)!;
      const { budgetUsd, ...limits } = old.permissions;
      // Only Claude bills dollars: a budget doesn't move to another runtime (decision 9). Moving to Codex, the dialog sends
      // the Stop after it requires.
      const kept = b.runtime === 'claude' && budgetUsd ? { ...limits, budgetUsd } : limits;
      const input = { runtime: b.runtime, model: b.model, effort: b.effort, tools: old.tools, knowledge: old.knowledge, permissions: b.stopAfterMin === undefined ? kept : { ...kept, stopAfterMin: b.stopAfterMin } };
      const draft = validateConfig(store, type, input, await runtimes());
      if ('field' in draft) return c.json({ error: draft.error, field: draft.field }, 400);
      setConversationConfig(db, conversation.id, saveConfig(db, store, type, draft).id);
      const changed = getConversation(db, conversation.id)!;
      return c.json({ ...changed, config: getConfig(db, changed.configId) });
    })
    // A question an agent asked (ask_owner), answered from its conversation's composer: the tool returns the text.
    .post('/api/approvals/:id/answer', async (c) => {
      const b = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
      if (!isText(b?.text, 1, 4000)) return c.json({ error: 'An answer is 1 to 4,000 characters.' }, 400);
      const a = getApproval(db, c.req.param('id'));
      if (!a || a.storeId !== c.req.query('store') || a.status !== 'pending' || a.action.kind !== 'question') return c.json({ error: 'That question is no longer waiting for an answer.' }, 409);
      const answered = decide(db, a.id, 'approve', b.text.trim());
      return answered && answered !== 'decided' ? c.json(answered) : c.json({ error: 'That question is no longer waiting for an answer.' }, 409);
    })
    // Save to Knowledge Base on a finished reply (decision 11): the block's text, tag and citations, the owner's title and
    // summary. It follows the workspace's review setting.
    .post('/api/runs/:id/findings', async (c) => {
      const run = getRun(db, c.req.param('id'));
      if (!run || run.storeId !== c.req.query('store')) return missing(c, 'Run');
      const b = (await c.req.json().catch(() => null)) as SaveFindingInput | null;
      if (!b || !Number.isInteger(b.block) || !isText(b.title, 5, 160) || !isText(b.summary, 10, 600)) return c.json({ error: 'Expected { block, title (5–160 characters), summary (10–600 characters) }' }, 400);
      if (run.status === 'queued' || run.status === 'running') return c.json({ error: 'Save a reply once it has finished.' }, 409);
      const live = db.prepare('SELECT at FROM done_once WHERE ref = ?').get(`activate:${run.storeId}`)?.at;
      if (live && run.createdAt < String(live)) return c.json({ error: 'That reply came from demo data, before the store went live, so it isn\'t saved.' }, 409);
      const text = replyBlocks(run.transcript)[b.block];
      if (!text) return missing(c, 'That part of the reply');
      const saved = captureFinding(db, run.storeId, { ...blockFinding(text), title: b.title.trim(), summary: b.summary.trim() }, { agentId: run.agentId, runId: run.id });
      if (saved.kind === 'refused') return c.json({ error: `Not saved: ${saved.reason}.` }, 409);
      const { id, title, stage, storeId, status } = saved.card;
      return c.json({ result: saved.kind, card: { id, title, stage, storeId, status } } satisfies FindingSaved, saved.kind === 'saved' ? 201 : 200);
    })
    .get('/api/conversations/:id/findings', (c) => {
      const conversation = mine(c);
      return conversation ? c.json(conversationFindings(db, conversation.id)) : missing(c);
    })
    .get('/api/conversations/:id/knowledge', (c) => {
      const conversation = mine(c);
      return conversation ? c.json(conversationKnowledge(db, conversation.id)) : missing(c);
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
      // While its team runs, "To: Lead" is a note for the synthesis (POST /api/teams/:id/notes), not a message.
      if (conversation.teamId && db.prepare('SELECT 1 FROM squad_missions WHERE id = ? AND ended_at IS NULL').get(conversation.teamId)) {
        return c.json({ error: 'The team is still running: send it as a note to the lead.' }, 409);
      }
      const attachments = await readAttachments(b.attachments);
      if (typeof attachments === 'string') return c.json({ error: attachments, field: 'attachments' }, 400);
      return started(c, runs.start(conversation.agentId, b.message.trim(), undefined, undefined, { conversationId: conversation.id, clientRequestId: b.clientRequestId, attachments }));
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
