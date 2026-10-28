import { randomUUID } from 'node:crypto';
import { econInputs, PR_BRIEF_FIELDS, PRODUCT_WRITE_PLATFORMS, type PrBrief, type PrBriefField, type PrLinks, type Store } from '@frontline/shared';
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
    .prepare(`SELECT kind, ref_id, created_at FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind IN ('store_product', 'experiment') ORDER BY created_at, rowid`)
    .all(store.id, id)
    .map((r) => {
      const kind = String(r.kind) as 'store_product' | 'experiment';
      const refId = String(r.ref_id);
      const name =
        kind === 'store_product'
          ? db.prepare('SELECT title, status FROM products WHERE store_id = ? AND id = ?').get(store.id, refId)
          : exp.find((e) => e.id === refId);
      return { kind, refId, label: !name ? 'No longer in the store' : kind === 'store_product' ? `${String(name.title)}${name.status === 'draft' ? ' (draft)' : ''}` : label(name), at: String(r.created_at) };
    });
  return { links, experiments: exp.map((e) => ({ id: String(e.id), label: label(e) })) };
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
