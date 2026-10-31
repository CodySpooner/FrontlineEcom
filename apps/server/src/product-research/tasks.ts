import { randomUUID } from 'node:crypto';
import { agentDefaults, costToday, getAgent, getConfig, getConversation, getRun, resolveType, runLimits, seatDefault, stateOf, type RunManager } from '@frontline/agents';
import {
  AGENT_ROLES,
  INTERRUPTED,
  PR_STAGE_LABEL,
  type ConversationConfigInput,
  type PrAgentRow,
  type PrOwnerDetails,
  type PrPreview,
  type PrStage,
  type PrTask,
  type PrTaskStatus,
  type RuntimeCapabilities,
  type RuntimeId,
  type Store,
} from '@frontline/shared';
import type { Db } from '../db';
import { openConversation } from '../routes/agents-conversations';
import { getCaps } from '../settings';
import { productVisible, upsertListing } from './catalog';
import { productDemand, productOffers } from './detail';
import { researchStarted } from './edits';
import { fence } from './fence';
import { refreshProduct } from './evaluate';
import { canonicalUrl, checkUrl, previewFields } from './preview';
import { getProfile } from './profile';
import { REAL_REPORT } from './reports';

// Research tasks (decision 6, PR-15): the owner asks an agent to research one product for one store. The run is the AI
// Agents lane's; this module only starts it, links it, and reads its state.

const SEAT = 'product_hunter';
export const INSTRUCTIONS_MAX = 6_000;
const EARLIER_MAX = 2_000;

/** The product_hunter seat and each custom role built on it this store may use. */
function eligibleTypes(db: Db, storeId: string) {
  const custom = db
    .prepare(`SELECT id, name FROM agent_custom_roles WHERE base_role = ? AND (store_id = ? OR store_id IS NULL) AND archived_at IS NULL ORDER BY name COLLATE NOCASE`)
    .all(SEAT, storeId)
    .map((r) => ({ type: String(r.id), name: String(r.name), custom: true }));
  return [{ type: SEAT, name: AGENT_ROLES[SEAT].name, custom: false }, ...custom];
}

/** Why the store's seat can't take a run now (seat off, budget spent), or null. */
function seatProblem(db: Db, store: Store): string | null {
  const agent = getAgent(db, `${store.id}:${SEAT}`);
  if (!agent?.enabled) return `The ${AGENT_ROLES[SEAT].name} is turned off in AI Agents.`;
  const cap = getCaps(db, store.id).agentCostPerDay;
  if (cap - costToday(db, store.id) < 0.01) return `Today's AI budget for this store ($${cap}) is used up. Raise it in Settings.`;
  if (agent.dailyBudgetUsd !== undefined && agent.dailyBudgetUsd - costToday(db, store.id, agent.id) < 0.01) return `The ${AGENT_ROLES[SEAT].name}'s own daily budget is used up.`;
  return null;
}

/** The type's most recent config in the store (what its dialog row shows). */
function latestConfig(db: Db, storeId: string, type: string) {
  const r = db
    .prepare(`SELECT id FROM agent_configs WHERE store_id = ? AND agent_id = ? AND custom_role_id IS ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(storeId, `${storeId}:${SEAT}`, type === SEAT ? null : type);
  return r ? getConfig(db, String(r.id)) : undefined;
}

/** One row per eligible agent type with its state (one call for the whole dialog). */
export function agentRows(db: Db, store: Store, caps: RuntimeCapabilities[]): PrAgentRow[] {
  const seat = seatProblem(db, store);
  const running = Number(db.prepare(`SELECT count(*) AS n FROM agent_runs WHERE store_id = ? AND status = 'running'`).get(store.id)!.n);
  const { perStore } = runLimits(db);
  return eligibleTypes(db, store.id).map(({ type, name, custom }) => {
    const latest = db
      .prepare(`SELECT runtime, model, effort, json_extract(permissions_json, '$.budgetUsd') AS budget FROM agent_configs WHERE store_id = ? AND agent_id = ? AND custom_role_id IS ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(store.id, `${store.id}:${SEAT}`, custom ? type : null);
    const fallback = latest ? undefined : seatDefault(store, resolveType(db, store.id, type)!, caps.find((c) => c.runtime === 'claude'), agentDefaults(db, store.id));
    const runtime = (latest ? String(latest.runtime) : fallback!.runtime) as RuntimeId;
    const cap = caps.find((c) => c.runtime === runtime);
    const reason = seat ?? (runtime !== 'demo' && cap && !cap.connected ? (cap.reason ?? `${runtime === 'claude' ? 'Claude' : 'Codex'} isn't connected: set it up in Integrations.`) : null);
    const active = db
      .prepare(
        `SELECT c.id, c.title, (SELECT count(*) FROM agent_runs q WHERE q.conversation_id = c.id AND q.status = 'queued') AS queued
         FROM conversations c JOIN agent_configs f ON f.id = c.config_id
         WHERE c.store_id = ? AND f.agent_id = ? AND f.custom_role_id IS ? AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.conversation_id = c.id AND r.status = 'running')
         ORDER BY c.last_activity_at DESC LIMIT 1`,
      )
      .get(store.id, `${store.id}:${SEAT}`, custom ? type : null);
    return {
      type,
      name,
      custom,
      runtime,
      model: latest ? (latest.model == null ? null : String(latest.model)) : (fallback!.model ?? null),
      effort: latest ? (latest.effort == null ? null : String(latest.effort)) : (fallback!.effort ?? null),
      budgetUsd: latest?.budget == null ? null : Number(latest.budget),
      state: reason ? 'not_ready' : active ? 'busy' : 'available',
      reason,
      busy: active ? { conversationId: String(active.id), title: String(active.title), queued: Number(active.queued), slotsFull: running >= perStore, perStore } : null,
    };
  });
}

export interface TaskInput {
  clientRequestId: string;
  /** Unset: a link the page wouldn't give, researched from the owner's details (`url` and `owner.title`). */
  productId?: string;
  listingId?: string;
  url?: string;
  preview?: Pick<PrPreview, 'title' | 'price' | 'variants'>;
  owner?: PrOwnerDetails;
  instructions: string;
  template?: string;
  type: string;
  mode: 'new' | 'queue' | 'separate';
  conversationId?: string;
  config?: ConversationConfigInput;
}

const line = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const money = (minor: number | null, currency: string | null) => (minor == null || !currency ? 'unknown' : `${(minor / 100).toFixed(2)} ${currency}`);

/** The product facts the agent gets (listing, offers, demand sets, preview fields with their origin): untrusted data. */
function facts(db: Db, store: Store, productId: string, preview: string | null): string {
  const listings = db
    .prepare(`SELECT id, title, source, origin, url, category FROM pr_listings WHERE product_id = ? AND origin != 'legacy_sample' AND (store_id IS NULL OR store_id = ?) ORDER BY first_seen_at LIMIT 5`)
    .all(productId, store.id)
    .map((l) => `- [listing:${l.id}] Listing: ${line([String(l.title), `source ${l.source} (${l.origin})`, l.category != null && `category ${l.category}`, l.url != null && String(l.url)])}`);
  const offers = productOffers(db, productId, store.id).map(
    (o) =>
      `- [offer:${o.id}] Offer: ${line([o.supplier, o.variant, o.destination && `to ${o.destination}`, `unit ${money(o.unitCost, o.currency)}`, `shipping ${money(o.shipCost, o.currency)}`, o.deliveryMax != null && `${o.deliveryMin ?? '?'}-${o.deliveryMax} days`, `provenance ${o.provenance}`, `checked ${o.checkedAt.slice(0, 10)}`, `status ${o.status}`])}`,
  );
  const sets = productDemand(db, productId, store.id).sets.map(
    (s) => `- [set:${s.id}] Demand set: ${line([s.platform, s.query && `"${s.query}"`, s.region, s.periodStart && `${s.periodStart} to ${s.periodEnd}`, s.metric, s.demandClass && `class ${s.demandClass}`, `origin ${s.origin}`, s.scope === 'query' && 'query-level'])}`,
  );
  const fields = preview ? Object.entries(JSON.parse(preview) as Record<string, { value: unknown; origin: string } | null>).filter(([, f]) => f) : [];
  const pasted = fields.map(([k, f]) => `- Preview ${k} (${f!.origin === 'owner' ? 'owner-provided' : 'from the page, not verified'}): ${typeof f!.value === 'string' ? f!.value : JSON.stringify(f!.value)}`);
  return [...listings, ...(offers.length ? offers : ['- No supplier offers yet']), ...(sets.length ? sets : ['- No demand sets yet']), ...pasted].join('\n');
}

/** "Earlier in <store>": stage, the last 3 stage changes with reasons, earlier reports, the owner's notes (this store's rows only). */
function earlier(db: Db, store: Store, productId: string): string {
  const e = db.prepare('SELECT stage, notes FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store.id, productId);
  const moves = db
    .prepare(`SELECT from_stage, to_stage, reason, at FROM pr_stage_history WHERE store_id = ? AND product_id = ? AND kind = 'stage' ORDER BY at DESC, rowid DESC LIMIT 3`)
    .all(store.id, productId)
    .map((h) => `- ${String(h.at).slice(0, 10)}: ${h.from_stage ?? 'new'} → ${h.to_stage}${h.reason ? ` (${h.reason})` : ''}`);
  const reports = db
    .prepare(`SELECT recommendation, report_json, created_at FROM pr_reports WHERE store_id = ? AND product_id = ? AND ${REAL_REPORT} ORDER BY created_at DESC`) // a demo report is never research (decision 7)
    .all(store.id, productId)
    .map((r) => `- Report ${String(r.created_at).slice(0, 10)}: ${r.recommendation}${((JSON.parse(String(r.report_json)) as { open_questions?: string[] }).open_questions ?? []).map((q) => `; open: ${q}`).join('')}`);
  const text = [
    `Stage: ${PR_STAGE_LABEL[(e?.stage ?? 'discovered') as PrStage]}`,
    ...(moves.length ? ['Stage changes:', ...moves] : []),
    ...(reports.length ? ['Earlier reports:', ...reports] : ['No earlier reports.']),
    ...(e?.notes ? [`Owner's notes: ${e.notes}`] : []),
  ].join('\n');
  return text.length > EARLIER_MAX ? `${text.slice(0, EARLIER_MAX)}…` : text;
}

/** The store's research profile (Settings → Product Research) as the task starts: what the product should fit. */
function profile(db: Db, store: Store): string {
  const p = getProfile(db, store);
  const list = (l: string[], none: string) => (l.length ? l.join(', ') : none);
  return [
    `- Audience: ${p.audience ?? 'not set'}`,
    `- Highest cost + shipping: ${p.priceMax === null ? 'not set' : money(p.priceMax, p.priceCurrency)}`,
    `- Ship to: ${p.shipTo ?? 'not set'}${p.shipToDefault && p.shipTo ? " (the store currency's main country)" : ''}`,
    `- Preferred ships-from: ${list(p.warehouses, 'any')}`,
    `- Longest delivery: ${p.maxDeliveryDays === null ? 'not set' : `${p.maxDeliveryDays} days`}`,
    `- Included categories: ${list(p.includeCategories, "the niche's only")}`,
    `- Avoided categories: ${list(p.avoidCategories, 'none')}`,
    `- Avoided terms: ${list(p.avoidTerms, 'none')}`,
    `- Keywords: ${list(p.keywords, 'none')}`,
  ].join('\n');
}

/**
 * The message (decision 6): header, the owner's instructions verbatim, then fenced blocks: the store's research profile
 * (settings ST-27), the product's facts and its history in the store. Read when the run starts, so a later profile
 * change never rewrites an earlier task's.
 */
export function taskMessage(db: Db, store: Store, task: { id: string; productId: string; instructions: string; preview: string | null }): string {
  const title = String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(task.productId)!.title);
  return [
    `Research task ${task.id} for product ${task.productId} ("${title.replace(/\s+/g, ' ')}") in ${store.name}. Finish by calling save_research_report once with this research task id.`,
    `## The owner's instructions\n${task.instructions}`,
    `## Store research profile\n${fence(profile(db, store), `${store.name}'s research profile`)}`,
    `## Product facts\n${fence(facts(db, store, task.productId, task.preview), 'Product Research facts for this product')}`,
    `## Earlier in ${store.name}\n${fence(earlier(db, store, task.productId), `Product Research history in ${store.name}`)}`,
  ].join('\n\n');
}

const RETRY: PrTaskStatus[] = ['not_started', 'interrupted', 'failed'];

/** The task as the page shows it: the status comes from the run, never stored. */
export function getTask(db: Db, id: string, storeId: string): PrTask | undefined {
  const t = db.prepare('SELECT * FROM pr_tasks WHERE id = ? AND store_id = ?').get(id, storeId);
  if (!t) return undefined;
  const run = t.run_id ? getRun(db, String(t.run_id)) : undefined;
  let status: PrTaskStatus = 'not_started';
  let detail: string | null = t.not_started_reason == null ? null : String(t.not_started_reason);
  if (run) {
    const s = stateOf(db, run);
    status = s === 'completed' ? (db.prepare('SELECT 1 FROM pr_reports WHERE run_id = ?').get(run.id) ? 'report_ready' : 'finished_without_report') : s === 'waiting_for_input' ? 'waiting_for_you' : s;
    detail = null;
    if (status === 'queued') {
      const ahead = run.conversationId && db.prepare(`SELECT 1 FROM agent_runs WHERE conversation_id = ? AND status = 'running'`).get(run.conversationId);
      detail = ahead ? `Behind "${getConversation(db, run.conversationId!)?.title ?? 'the current work'}"` : `Waiting for a free store slot (${runLimits(db).perStore} per store)`;
    } else if (status === 'failed') detail = run.error ?? null;
  }
  return {
    id: String(t.id),
    storeId: String(t.store_id),
    productId: String(t.product_id),
    listingId: t.listing_id == null ? null : String(t.listing_id),
    url: t.url == null ? null : String(t.url),
    instructions: String(t.instructions),
    template: t.template == null ? null : String(t.template),
    mode: String(t.mode) as PrTask['mode'],
    type: String(t.type),
    conversationId: t.conversation_id == null ? null : String(t.conversation_id),
    runId: run?.id ?? null,
    status,
    detail,
    canRetry: RETRY.includes(status),
    createdAt: String(t.created_at),
    updatedAt: run ? (run.endedAt ?? run.startedAt ?? run.createdAt) : String(t.updated_at),
  };
}

/** The latest task's id for each product in the store (the card footer). */
export const latestTask = (db: Db, storeId: string, productId: string) =>
  db.prepare('SELECT id FROM pr_tasks WHERE store_id = ? AND product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(storeId, productId)?.id as string | undefined;

/**
 * getTask's status rule (runState, then the report) in SQL for the discovery Research filter: the latest task of `p.id`
 * in the store bound to its one `?`; NULL when there is none. tasks.test.ts checks the two agree.
 */
export const RESEARCH_SQL = `(SELECT CASE
    WHEN r.id IS NULL THEN 'not_started'
    WHEN r.status = 'queued' THEN 'queued'
    WHEN r.status = 'running' THEN CASE
      WHEN EXISTS (SELECT 1 FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending' AND coalesce(json_extract(a.action_json, '$.kind'), '') != 'question') THEN 'awaiting_approval'
      WHEN EXISTS (SELECT 1 FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending') THEN 'waiting_for_you'
      ELSE 'running' END
    WHEN r.status = 'error' THEN iif(r.error = '${INTERRUPTED.replace(/'/g, "''")}', 'interrupted', 'failed')
    WHEN r.status = 'cancelled' THEN 'cancelled'
    WHEN EXISTS (SELECT 1 FROM pr_reports x WHERE x.run_id = r.id) THEN 'report_ready'
    ELSE 'finished_without_report' END
  FROM pr_tasks t LEFT JOIN agent_runs r ON r.id = t.run_id WHERE t.store_id = ? AND t.product_id = p.id ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1)`;

export const listTasks = (db: Db, storeId: string, productId?: string): PrTask[] =>
  db
    .prepare(`SELECT id FROM pr_tasks WHERE store_id = ? ${productId ? 'AND product_id = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT 200`)
    .all(storeId, ...(productId ? [productId] : []))
    .map((r) => getTask(db, String(r.id), storeId)!);

type Started = { task: PrTask; status: 200 | 201 | 409 } | { error: string; status: 400 | 404 | 409; field?: string };

/** Starts (or starts again) the task's run in its mode and links it; a refusal is kept on the task as Not started. */
function launch(db: Db, runs: RunManager, store: Store, id: string, caps: RuntimeCapabilities[], config?: ConversationConfigInput, retryOf?: string): Started {
  const t = db.prepare('SELECT * FROM pr_tasks WHERE id = ?').get(id)!;
  const crid = retryOf ? randomUUID() : String(t.client_request_id);
  const message = taskMessage(db, store, { id, productId: String(t.product_id), instructions: String(t.instructions), preview: t.preview_json == null ? null : String(t.preview_json) });
  const title = String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(String(t.product_id))!.title);
  const conversation = t.conversation_id ? getConversation(db, String(t.conversation_id)) : undefined;
  let result: { runId: string; conversationId: string; configId: string | null } | string;
  if (retryOf || String(t.mode) === 'queue') {
    if (!conversation) result = 'The conversation is gone: start the research again.';
    else {
      const run = runs.start(conversation.agentId, retryOf ? getRun(db, retryOf)!.task : message, undefined, undefined, { conversationId: conversation.id, clientRequestId: crid, ...(retryOf ? { retryOf } : {}) });
      result = typeof run === 'string' ? run : { runId: run.id, conversationId: conversation.id, configId: run.configId ?? null };
    }
  } else {
    // Separate: the busy conversation's config. New: Deploy's choice, else the config the dialog's row showed (the type's
    // latest in the store), else none (the seat default, as the row said).
    const from = String(t.mode) === 'separate' && conversation ? getConfig(db, conversation.configId) : config ? undefined : latestConfig(db, store.id, String(t.type));
    const cfg: ConversationConfigInput | undefined = from ? { runtime: from.runtime, ...(from.model ? { model: from.model } : {}), ...(from.effort ? { effort: from.effort } : {}), tools: from.tools, knowledge: from.knowledge, permissions: from.permissions } : config;
    const opened = openConversation(db, runs, store, { clientRequestId: crid, type: String(t.type), message, title: `Research: ${title}`.slice(0, 200), context: { kind: 'product', id: String(t.product_id), name: title.slice(0, 200) }, ...(cfg ? { config: cfg } : {}) }, caps);
    if ('status' in opened && opened.field) {
      // A Deploy config that fails its check: the dialog shows it on the field; a repeat with a fixed config starts it.
      db.prepare('UPDATE pr_tasks SET not_started_reason = ?, updated_at = ? WHERE id = ?').run(opened.error, new Date().toISOString(), id);
      return { error: opened.error, status: 400, field: opened.field };
    }
    result = 'status' in opened ? opened.error : { runId: opened.run.id, conversationId: opened.conversation.id, configId: opened.conversation.configId };
  }
  const at = new Date().toISOString();
  if (typeof result === 'string') {
    db.prepare('UPDATE pr_tasks SET not_started_reason = ?, updated_at = ? WHERE id = ?').run(result, at, id);
    return { task: getTask(db, id, store.id)!, status: 409 };
  }
  db.prepare('UPDATE pr_tasks SET conversation_id = ?, run_id = ?, config_id = ?, not_started_reason = NULL, updated_at = ? WHERE id = ?').run(result.conversationId, result.runId, result.configId, at, id);
  researchStarted(db, store, String(t.product_id), id);
  return { task: getTask(db, id, store.id)!, status: 201 };
}

/**
 * POST /api/pr/tasks: check, insert, compose, start, link (decision 6). A repeat returns the same task; a repeat whose run
 * never started starts it under the same task, with what the repeat sends (the owner may have fixed the draft).
 */
export function startTask(db: Db, runs: RunManager, store: Store, input: TaskInput, caps: RuntimeCapabilities[]): Started {
  const prior = db.prepare('SELECT id, run_id FROM pr_tasks WHERE store_id = ? AND client_request_id = ?').get(store.id, input.clientRequestId);
  if (prior?.run_id) return { task: getTask(db, String(prior.id), store.id)!, status: 200 };
  if (!input.productId) {
    const made = byHand(db, store, input.url, input.owner?.title);
    if ('error' in made) return { error: made.error, status: 400, field: 'link' };
    input = { ...input, ...made };
  }
  const productId = input.productId!;
  if (!productVisible(db, productId, store.id)) return { error: 'Product not found', status: 404 };
  const type = resolveType(db, store.id, input.type);
  if (!type) return { error: 'Agent type not found', status: 404 };
  if (type.role !== SEAT) return { error: `Only the ${AGENT_ROLES[SEAT].name} or a custom role built on it can research products.`, status: 409 };
  let conversationId: string | null = null;
  if (input.mode !== 'new') {
    const c = input.conversationId ? getConversation(db, input.conversationId) : undefined;
    if (!c || c.storeId !== store.id) return { error: 'Conversation not found', status: 404 };
    if (c.type !== input.type) return { error: "That conversation is another agent type's.", status: 409 };
    conversationId = c.id;
  }
  const listing = input.listingId && db.prepare(`SELECT 1 FROM pr_listings WHERE id = ? AND product_id = ? AND (store_id IS NULL OR store_id = ?)`).get(input.listingId, productId, store.id) ? input.listingId : null;
  const preview = input.preview || input.owner ? JSON.stringify(previewFields(input.preview ?? { title: null, price: null, variants: [] }, input.owner ?? {})) : null;
  const id = prior ? String(prior.id) : randomUUID();
  const at = new Date().toISOString();
  const fields = [productId, listing, input.url ?? null, preview, input.instructions, input.template ?? null, input.mode, input.type, conversationId] as const;
  if (prior) db.prepare('UPDATE pr_tasks SET product_id = ?, listing_id = ?, url = ?, preview_json = ?, instructions = ?, template = ?, mode = ?, type = ?, conversation_id = ?, updated_at = ? WHERE id = ?').run(...fields, at, id);
  else
    db.prepare(
      `INSERT INTO pr_tasks (id, store_id, product_id, listing_id, url, preview_json, instructions, template, mode, type, conversation_id, client_request_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, store.id, ...fields, input.clientRequestId, at, at);
  return launch(db, runs, store, id, caps, input.config);
}

/**
 * A link whose page couldn't be read, with the owner's details: the store's listing for that link (one it already has,
 * else a private `owner_link` listing named by the owner, marked owner-entered: nothing was read from the page).
 */
function byHand(db: Db, store: Store, url: string | undefined, title: string | undefined): { productId: string; listingId: string } | { error: string } {
  const link = checkUrl(url);
  if ('error' in link) return { error: 'Paste the product link, or open the product to research.' };
  if (!title?.trim()) return { error: "The page wasn't read: enter the product's title by hand." };
  const canonical = canonicalUrl(link.parsed);
  const known = db.prepare(`SELECT id, product_id FROM pr_listings WHERE canonical_url = ? AND origin != 'legacy_sample' AND (store_id IS NULL OR store_id = ?) ORDER BY store_id IS NULL, first_seen_at LIMIT 1`).get(canonical, store.id);
  if (known) return { productId: String(known.product_id), listingId: String(known.id) };
  const made = upsertListing(db, { source: 'owner_link', sourceRef: canonical, storeId: store.id, origin: 'owner_link', title: title.trim(), url: link.url, canonicalUrl: canonical, transform: { ownerEntered: true } });
  refreshProduct(db, made.productId);
  return { productId: made.productId, listingId: made.id };
}

/** Retry: a task that never started starts again; an interrupted or failed run is retried in its conversation. */
export function retryTask(db: Db, runs: RunManager, store: Store, id: string, caps: RuntimeCapabilities[]): Started {
  const task = getTask(db, id, store.id);
  if (!task) return { error: 'Research task not found', status: 404 };
  if (!task.canRetry) return { error: `It is ${task.status.replace(/_/g, ' ')}: nothing to retry.`, status: 409 };
  return launch(db, runs, store, id, caps, undefined, task.runId ?? undefined);
}
