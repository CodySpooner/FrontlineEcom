import { randomUUID } from 'node:crypto';
import { createCard, ensureCategoryPath } from '@frontline/agents';
import { econInputs, PR_BRIEF_FIELDS, PR_BRIEF_LABEL, PR_ECON_LABEL, PR_SPECIALIST_ASKS, PR_STAGE_LABEL, PRODUCT_WRITE_PLATFORMS, type PrBrief, type PrBriefField, type PrLinks, type PrSpecialistAsk, type PrSpecialistTeam, type PrStage, type Store } from '@frontline/shared';
import { approvalsHook, getApproval } from '../approvals';
import type { Db } from '../db';
import { productEconomics, baseEconomics } from './economics';
import { evaluate } from './evaluate';
import { history } from './edits';
import { minorDigits } from './money';
import { getProfile } from './profile';
import { reportAssessment } from './reports';

// The pipeline's owner fields (PR-22): who handles a product, what it led to, the test brief, and the draft product
// handoff, which is only ever an approval request. Nothing here publishes or buys anything.

type Result = { error: string; status: 400 | 404 | 409 } | null;
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (minor: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 10 ** (minorDigits(currency) ?? 2));
const major = (minor: number, currency: string) => minor / 10 ** (minorDigits(currency) ?? 2);

/** Who handles it in the store (the owner's text; empty clears it), kept in History. */
export function setOwner(db: Db, store: Store, id: string, owner: string, now = new Date()) {
  const get = () => db.prepare('SELECT owner FROM pr_evaluations WHERE store_id = ? AND product_id = ?').get(store.id, id);
  const from = (get() ?? (evaluate(db, store, id, now), get()))?.owner;
  if ((from ?? '') === owner) return;
  db.prepare('UPDATE pr_evaluations SET owner = ?, updated_at = ? WHERE store_id = ? AND product_id = ?').run(owner || null, now.toISOString(), store.id, id);
  history(db, { storeId: store.id, productId: id, kind: 'owner', from: from == null ? null : String(from), to: owner || null, reason: null, at: now });
}

/** The store products it became and the KB experiments linked to it, plus the store's experiments to pick from. */
export function productLinks(db: Db, store: Store, id: string): PrLinks {
  const exp = db.prepare(`SELECT e.id, e.metric, e.status, c.title FROM kb_experiments e JOIN kb_cards c ON c.id = e.card_id WHERE e.store_id = ? ORDER BY e.created_at DESC LIMIT 50`).all(store.id);
  const label = (e: Record<string, unknown>) => `${String(e.title)}: ${String(e.metric)} (${String(e.status)})`;
  const links = db
    .prepare(`SELECT kind, ref_id, created_at FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind IN ('store_product', 'experiment', 'team') ORDER BY created_at, rowid`)
    .all(store.id, id)
    .map((r) => {
      const kind = String(r.kind) as PrLinks['links'][number]['kind'];
      const refId = String(r.ref_id);
      if (kind === 'team') {
        const t = db.prepare(`SELECT title FROM squad_missions WHERE id = ? AND store_id = ? AND kind = 'team'`).get(refId, store.id);
        return { kind, refId, label: t ? String(t.title) : 'A team that is gone', at: String(r.created_at) };
      }
      const name =
        kind === 'store_product'
          ? db.prepare('SELECT title, status FROM products WHERE store_id = ? AND id = ?').get(store.id, refId)
          : exp.find((e) => e.id === refId);
      return { kind, refId, label: !name ? 'No longer in the store' : kind === 'store_product' ? `${String(name.title)}${name.status === 'draft' ? ' (draft)' : ''}` : label(name), at: String(r.created_at) };
    });
  return { links, experiments: exp.map((e) => ({ id: String(e.id), label: label(e) })) };
}

/** PR-24: links a team started from the product ("Ask a specialist"); only one of this store's teams. */
export function linkTeam(db: Db, store: Store, id: string, teamId: string, now = new Date()): Result {
  const t = db.prepare(`SELECT title FROM squad_missions WHERE id = ? AND store_id = ? AND kind = 'team'`).get(teamId, store.id);
  if (!t) return { error: 'team not found', status: 404 };
  const added = db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, created_at) VALUES (?, ?, ?, 'team', ?, ?)`).run(randomUUID(), store.id, id, teamId, now.toISOString()).changes;
  if (added) history(db, { storeId: store.id, productId: id, kind: 'team', reason: `Asked a specialist: ${String(t.title)}`, at: now });
  return null;
}

/**
 * PR-24: the team "Ask a specialist" starts on the AI Agents team engine: Product Researcher leads and consolidates,
 * the specialist contributes. The objective carries only stored facts, each labelled, and the owner's brief if saved.
 */
export function specialistTeam(db: Db, store: Store, id: string, ask: PrSpecialistAsk): PrSpecialistTeam {
  const a = PR_SPECIALIST_ASKS[ask];
  const p = db.prepare('SELECT title, category FROM pr_products WHERE id = ?').get(id)!;
  const title = String(p.title);
  const econ = baseEconomics(db, store, id);
  const price = econInputs(productEconomics(db, store, id), 'base').price;
  const brief = db.prepare('SELECT fields_json FROM pr_briefs WHERE store_id = ? AND product_id = ? ORDER BY updated_at DESC LIMIT 1').get(store.id, id);
  const fields = brief ? (JSON.parse(String(brief.fields_json)) as Partial<Record<PrBriefField, string>>) : {};
  const roas = (r: number | null) => (r === null ? 'none (contribution not above zero)' : `${r.toFixed(2)}×`);
  const facts = [
    `Product: ${title} (category: ${p.category == null ? 'unknown' : String(p.category)}).`,
    `Store: ${store.name}; audience: ${getProfile(db, store).audience ?? 'not set'}.`,
    econ.figures && price !== null
      ? `Base economics (the owner's scenario): selling price ${money(price, store.currency)}, contribution before ads ${money(econ.figures.before, store.currency)} per order, break-even ROAS ${roas(econ.figures.breakEvenRoas)}.`
      : `Base economics: incomplete (missing ${econ.missing.map((k) => PR_ECON_LABEL[k].toLowerCase()).join(', ')}).`,
    ...PR_BRIEF_FIELDS.filter((k) => fields[k]).map((k) => `Owner's test brief, ${PR_BRIEF_LABEL[k].toLowerCase()}: ${fields[k]!.slice(0, 400)}`),
  ];
  const job =
    ask === 'positioning'
      ? `${a.who}: propose the positioning for this product in this store and three ad angles to test, each with the audience it targets, the hook and the creative it needs.`
      : `${a.who}: propose a measurement plan for a first test: the metrics, the tracking each needs, the window and minimum sample, and stop / continue thresholds tied to the break-even ROAS above.`;
  const objective = [
    `Asked from Product Research about "${title}". ${job}`,
    'Product Researcher leads: plan the work, then consolidate one answer for the owner. Everything you propose is a proposal, not evidence; say what is unknown. Do not launch, publish or spend anything.',
    'Stored facts (from the app, not checked by you):',
    ...facts.map((f) => `- ${f}`),
  ].join('\n');
  return { title: `${title}: ${a.label.toLowerCase()}`.slice(0, 200), objective: objective.slice(0, 4000), participants: [{ type: 'product_hunter' }, { type: a.type }] };
}

/** Links or unlinks one of the store's KB experiments (History keeps both). */
export function linkExperiment(db: Db, store: Store, id: string, refId: string, on: boolean, now = new Date()): Result {
  const e = db.prepare('SELECT 1 FROM kb_experiments WHERE id = ? AND store_id = ?').get(refId, store.id);
  if (on && !e) return { error: 'experiment not found', status: 404 };
  const changed = on
    ? db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, created_at) VALUES (?, ?, ?, 'experiment', ?, ?)`).run(randomUUID(), store.id, id, refId, now.toISOString()).changes
    : db.prepare(`DELETE FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind = 'experiment' AND ref_id = ?`).run(store.id, id, refId).changes;
  if (!changed) return on ? null : { error: 'link not found', status: 404 };
  const name = productLinks(db, store, id).experiments.find((x) => x.id === refId)?.label ?? refId;
  history(db, { storeId: store.id, productId: id, kind: 'experiment', reason: `${on ? 'Linked' : 'Unlinked'}: ${name}`, at: now });
  return null;
}

/**
 * The test brief: the owner's saved one, else a prefill from stored data only (the profile's audience, the latest
 * non-demo report's proposals, the base economics); a field with nothing stored stays empty.
 */
export function getBrief(db: Db, store: Store, id: string): PrBrief {
  const saved = db.prepare('SELECT fields_json, updated_at FROM pr_briefs WHERE store_id = ? AND product_id = ? ORDER BY updated_at DESC LIMIT 1').get(store.id, id);
  const fields = Object.fromEntries(PR_BRIEF_FIELDS.map((k) => [k, ''])) as Record<PrBriefField, string>;
  if (saved) return { fields: { ...fields, ...(JSON.parse(String(saved.fields_json)) as Partial<Record<PrBriefField, string>>) }, from: {}, updatedAt: String(saved.updated_at) };
  const from: PrBrief['from'] = {};
  const audience = getProfile(db, store).audience;
  if (audience) (fields.targetCustomer = audience), (from.targetCustomer = 'Research profile');
  const report = reportAssessment(db, store.id, id).report;
  const proposals = (kind: string) => report?.proposals.filter((p) => p.kind === kind).map((p) => p.text) ?? [];
  if (proposals('differentiation').length) (fields.offerHypothesis = proposals('differentiation').join('\n')), (from.offerHypothesis = `Proposal: report of ${date(report!.createdAt)}`);
  if (proposals('ad_angle').length) (fields.creativeConcepts = proposals('ad_angle').map((t) => `- ${t}`).join('\n')), (from.creativeConcepts = `Proposal: report of ${date(report!.createdAt)}`);
  const econ = baseEconomics(db, store, id);
  const price = econInputs(productEconomics(db, store, id), 'base').price;
  if (econ.figures && price !== null) {
    const f = econ.figures;
    fields.budgetAssumptions = [
      `Selling price ${money(price, store.currency)}; contribution before ads ${money(f.before, store.currency)} per order, the most an order can cost to acquire.`,
      f.breakEvenRoas === null ? 'No break-even ROAS: the contribution before ads is not above zero.' : `Break-even ROAS ${f.breakEvenRoas.toFixed(2)}×.`,
      econ.excluded.length ? `Left out (unknown): ${econ.excluded.join(', ')}.` : '',
    ].filter(Boolean).join(' ');
    from.budgetAssumptions = 'Base economics';
  }
  return { fields, from, updatedAt: null };
}

export function parseBrief(body: unknown): Record<PrBriefField, string> | string {
  const f = ((body ?? {}) as { fields?: unknown }).fields as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') return 'fields is required';
  const out = {} as Record<PrBriefField, string>;
  for (const k of Object.keys(f)) if (!PR_BRIEF_FIELDS.includes(k as PrBriefField)) return `${k} is not a brief field`;
  for (const k of PR_BRIEF_FIELDS) {
    const v = f[k] ?? '';
    if (typeof v !== 'string' || v.length > 4000) return `${k} must be text (up to 4,000 characters)`;
    out[k] = v.trim();
  }
  return out;
}

export function saveBrief(db: Db, store: Store, id: string, fields: Record<PrBriefField, string>, now = new Date()) {
  const at = now.toISOString();
  const row = db.prepare('SELECT id FROM pr_briefs WHERE store_id = ? AND product_id = ? ORDER BY updated_at DESC LIMIT 1').get(store.id, id);
  if (row) db.prepare('UPDATE pr_briefs SET fields_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(fields), at, String(row.id));
  else db.prepare('INSERT INTO pr_briefs (id, store_id, product_id, fields_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), store.id, id, JSON.stringify(fields), at, at);
  return getBrief(db, store, id);
}

/**
 * PR-23: the owner saves a stage decision (a History row) as a card in the store's Knowledge Base, under "Product
 * decisions": the owner's own (User-Provided Knowledge, active), at the Hypothesis stage because a decision is not a
 * measured result. Findings from reports go to "Findings" through captureFinding instead, so the two stay apart. Saving
 * the same row twice returns its card.
 */
export function saveDecision(db: Db, store: Store, id: string, historyId: string, now = new Date()): { cardId: string; created: boolean } | { error: string; status: 404 | 409 } {
  const h = db.prepare(`SELECT from_stage, to_stage, reason, at FROM pr_stage_history WHERE id = ? AND store_id = ? AND product_id = ? AND kind = 'stage' AND by = 'owner'`).get(historyId, store.id, id);
  if (!h || !h.to_stage) return { error: "Only the owner's own stage decisions can be saved.", status: 404 };
  const saved = db.prepare(`SELECT ref_id FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind = 'kb_card' AND context_json ->> '$.historyId' = ?`).get(store.id, id, historyId);
  if (saved && db.prepare(`SELECT 1 FROM kb_cards WHERE id = ? AND status IN ('proposed', 'active')`).get(String(saved.ref_id))) return { cardId: String(saved.ref_id), created: false };
  const product = String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(id)?.title ?? 'A product');
  const to = PR_STAGE_LABEL[String(h.to_stage) as PrStage] ?? String(h.to_stage);
  // Card titles are unique in a store: one decision card per product, stage and day.
  const title = `${product}: ${to} (${date(String(h.at))})`;
  const summary = `${store.name} moved "${product}" to ${to}${h.reason ? `: ${String(h.reason)}` : ''}.`;
  const same = db.prepare('SELECT id, status FROM kb_cards WHERE store_id = ? AND lower(title) = lower(?)').get(store.id, title);
  if (same && !['proposed', 'active'].includes(String(same.status))) return { error: 'You archived or rejected a card that says this; restore it in the Knowledge Base instead.', status: 409 };
  const cardId =
    (same && String(same.id)) ??
    createCard(
      db,
      store.id,
      {
        categoryId: ensureCategoryPath(db, store.id, ['Product decisions']), title, summary,
        body: `A decision in Product Research${h.from_stage ? `, from ${PR_STAGE_LABEL[String(h.from_stage) as PrStage] ?? String(h.from_stage)}` : ''}. It records what was decided and why, not a measured result.`,
        tags: ['product-research', 'decision'], type: 'user_provided', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner',
      },
      now,
    ).id;
  db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, context_json, created_at) VALUES (?, ?, ?, 'kb_card', ?, ?, ?)`).run(
    randomUUID(), store.id, id, cardId, JSON.stringify({ historyId }), now.toISOString(),
  );
  return { cardId, created: !same };
}

/**
 * "Prepare draft product": a `store.add_products` approval request (T9: with `prProductId`, so the store product it
 * becomes links back). The price is the owner's base-scenario selling price; nothing happens until the owner approves,
 * and then only a draft is made. A pending request for the same title is returned instead of a second one.
 */
export function requestDraftProduct(db: Db, store: Store, id: string): { approval: ReturnType<typeof getApproval>; created: boolean } | { error: string; status: 400 | 409 } {
  if (store.connected && !PRODUCT_WRITE_PLATFORMS.includes(store.platform))
    return { error: `Draft products are only made automatically on Shopify and WooCommerce stores for now. Add it to ${store.name} by hand.`, status: 400 };
  const title = String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(id)?.title ?? '');
  const linked = db.prepare(`SELECT p.title FROM pr_outcomes o JOIN products p ON p.store_id = o.store_id AND p.id = o.ref_id WHERE o.store_id = ? AND o.product_id = ? AND o.kind = 'store_product'`).get(store.id, id);
  if (linked) return { error: `Already in ${store.name}: ${String(linked.title)}.`, status: 409 };
  const inputs = econInputs(productEconomics(db, store, id), 'base');
  if (inputs.price === null) return { error: 'Set a selling price in Economics (base) first: the draft uses it.', status: 409 };
  const asked = db
    .prepare(
      `SELECT a.id FROM approvals a, json_each(a.action_json, '$.payload.products') p
       WHERE a.store_id = ? AND a.status = 'pending' AND a.action_json ->> '$.kind' = 'store.add_products' AND lower(trim(p.value ->> '$.title')) = lower(trim(?))`,
    )
    .get(store.id, title);
  if (asked) return { approval: getApproval(db, String(asked.id)), created: false };
  const approval = approvalsHook(db).create({
    storeId: store.id,
    agentId: `${store.id}:product_hunter`,
    title: `Add "${title}" to ${store.name} as a draft`,
    reason: `From Product Research: selling price ${money(inputs.price, store.currency)} (your Economics base scenario)${inputs.supplierCost === null ? '' : `, supplier cost ${money(inputs.supplierCost, store.currency)}`}. Approving makes a draft only: nothing is published or bought.`,
    action: {
      kind: 'store.add_products',
      payload: { products: [{ prProductId: id, title, price: major(inputs.price, store.currency), ...(inputs.supplierCost === null ? {} : { cost: major(inputs.supplierCost, store.currency) }) }] },
    },
  });
  return { approval, created: true };
}
