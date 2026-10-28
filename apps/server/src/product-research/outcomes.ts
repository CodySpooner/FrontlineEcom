import { randomUUID } from 'node:crypto';
import { createCard, ensureCategoryPath } from '@frontline/agents';
import { econInputs, type PrOutcomeProduct, type PrOutcomes, type PrRecommendation, type Store } from '@frontline/shared';
import type { Db } from '../db';
import { productSales, storeDay } from '../routes/agents-outcomes';
import { baseEconomics, productEconomics } from './economics';
import { minorDigits } from './money';
import { getProfile } from './profile';
import { REAL_REPORT } from './reports';

/**
 * PR-25 (spec §12): what happened to a researched product in this store. Each linked store product with its
 * `product_tests` row, its paid orders since it was added (`productSales`; a demo store's orders are generated and never
 * count), the offer and inventory now, beside the owner's base assumptions, linked experiments and KB lessons. Reads
 * only: a report is never edited to fit what happened.
 */
export function productOutcomes(db: Db, store: Store, id: string, now = new Date()): PrOutcomes {
  const real = db.prepare('SELECT demo FROM stores WHERE id = ?').get(store.id)?.demo === 0;
  const minor = (major: number) => Math.round(major * 10 ** (minorDigits(store.currency) ?? 2));
  const to = storeDay(db, store.id, now.getTime());
  const saved = db
    .prepare(`SELECT o.ref_id, o.context_json FROM pr_outcomes o JOIN kb_cards c ON c.id = o.ref_id WHERE o.store_id = ? AND o.product_id = ? AND o.kind = 'kb_card' AND c.status IN ('proposed', 'active')`)
    .all(store.id, id);
  const products = db
    .prepare(`SELECT ref_id, created_at FROM pr_outcomes WHERE store_id = ? AND product_id = ? AND kind = 'store_product' ORDER BY created_at, rowid`)
    .all(store.id, id)
    .map((l): PrOutcomeProduct => {
      const ref = String(l.ref_id);
      const p = db.prepare('SELECT title, status, price, compare_at, inventory FROM products WHERE store_id = ? AND id = ?').get(store.id, ref);
      const t = db.prepare('SELECT added_on, approval_id, judged_at FROM product_tests WHERE store_id = ? AND product_id = ?').get(store.id, ref);
      const from = t ? String(t.added_on).slice(0, 10) : storeDay(db, store.id, String(l.created_at));
      const s = real ? productSales(db, store.id, ref, from, to) : null;
      const card = saved.find((c) => {
        const x = JSON.parse(String(c.context_json ?? '{}')) as { storeProductId?: string; to?: string };
        return x.storeProductId === ref && x.to === to;
      });
      return {
        storeProductId: ref,
        title: p ? String(p.title) : null,
        status: p ? String(p.status) : null,
        test: t ? { addedOn: String(t.added_on), approvalId: String(t.approval_id), judgedAt: t.judged_at == null ? null : String(t.judged_at) } : null,
        period: { from, to },
        offer: p ? { price: minor(Number(p.price)), compareAt: p.compare_at == null ? null : minor(Number(p.compare_at)) } : null,
        inventory: p ? Number(p.inventory) : null,
        observed: s && {
          units: s.units,
          revenue: minor(s.revenue),
          profit: minor(s.profit),
          uncosted: !!s.uncosted,
          pricePerUnit: s.units ? minor(s.revenue / s.units) : null,
          profitPerUnit: s.units && !s.uncosted ? minor(s.profit / s.units) : null,
        },
        ...(card ? { cardId: String(card.ref_id) } : {}),
      };
    });
  const report = db.prepare(`SELECT recommendation, created_at FROM pr_reports WHERE store_id = ? AND product_id = ? AND ${REAL_REPORT} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(store.id, id);
  const econ = baseEconomics(db, store, id);
  const price = econInputs(productEconomics(db, store, id), 'base').price;
  const experiments = db
    .prepare(`SELECT e.id, e.metric, e.status, e.result_json, c.title FROM pr_outcomes o JOIN kb_experiments e ON e.id = o.ref_id JOIN kb_cards c ON c.id = e.card_id WHERE o.store_id = ? AND o.product_id = ? AND o.kind = 'experiment' ORDER BY o.created_at`)
    .all(store.id, id)
    // result_json is the KB lane's {text} (apps/server/src/kb/experiments.ts).
    .map((e) => ({ id: String(e.id), label: `${String(e.title)}: ${String(e.metric)}`, status: String(e.status), result: e.result_json == null ? null : String(JSON.parse(String(e.result_json)).text) }));
  const lessons = db
    .prepare(`SELECT c.id, c.title, c.stage FROM pr_outcomes o JOIN kb_cards c ON c.id = o.ref_id WHERE o.store_id = ? AND o.product_id = ? AND o.kind = 'kb_card' AND c.status IN ('proposed', 'active') ORDER BY o.created_at`)
    .all(store.id, id)
    .map((c) => ({ cardId: String(c.id), title: String(c.title), stage: String(c.stage) }));
  return {
    currency: store.currency,
    research: report ? { recommendation: String(report.recommendation) as PrRecommendation, at: String(report.created_at) } : null,
    assumed: econ.figures && price !== null ? { price, contribution: econ.figures.before, breakEvenRoas: econ.figures.breakEvenRoas } : null,
    audience: getProfile(db, store).audience ?? null,
    products,
    experiments,
    lessons,
  };
}

/**
 * "Save outcome to Knowledge Base": a measured period of a linked store product becomes the owner's card under
 * "Product outcomes", its context kept with it (in the card and in `pr_outcomes.context_json`). Once per period end.
 */
export function saveOutcome(db: Db, store: Store, id: string, storeProductId: string, now = new Date()): { cardId: string; created: boolean } | { error: string; status: 404 | 409 } {
  const all = productOutcomes(db, store, id, now);
  const o = all.products.find((p) => p.storeProductId === storeProductId);
  if (!o) return { error: 'store product not linked', status: 404 };
  if (o.cardId) return { cardId: o.cardId, created: false };
  if (!o.observed?.units) return { error: 'Nothing measured yet: an outcome is saved once the store has real paid orders for it.', status: 409 };
  const money = (minor: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: store.currency }).format(minor / 10 ** (minorDigits(store.currency) ?? 2));
  const product = String(db.prepare('SELECT title FROM pr_products WHERE id = ?').get(id)?.title ?? 'A product');
  const { units, revenue, profit, uncosted, pricePerUnit, profitPerUnit } = o.observed;
  const title = `${product}: ${units} sold in ${store.name} (${o.period.from} to ${o.period.to})`;
  if (db.prepare(`SELECT 1 FROM kb_cards WHERE store_id = ? AND lower(title) = lower(?) AND status NOT IN ('proposed', 'active')`).get(store.id, title))
    return { error: 'You archived or rejected a card that says this; restore it in the Knowledge Base instead.', status: 409 };
  const summary = `${units} units, ${money(revenue)} revenue, ${uncosted ? 'profit unknown (no unit cost)' : `${money(profit)} profit after unit cost and store fees`}, ${o.period.from} to ${o.period.to}.`;
  const a = all.assumed;
  const body = [
    a
      ? `Assumed (base economics): ${money(a.price)} selling price, ${money(a.contribution)} contribution before ads per order. Observed: ${pricePerUnit === null ? 'no' : money(pricePerUnit)} revenue per unit, ${profitPerUnit === null ? 'unknown' : money(profitPerUnit)} profit per unit (before shipping, returns and ads).`
      : 'No base economics were set to compare with.',
    `Context: offer ${o.offer ? `${money(o.offer.price)}${o.offer.compareAt ? ` (compare at ${money(o.offer.compareAt)})` : ''}` : 'unknown'}; audience ${all.audience ?? 'not set'}; inventory ${o.inventory ?? 'unknown'}; creative and ad spend aren't tracked per product; period ${o.period.from} to ${o.period.to}.`,
    'Sales alone don\'t show the product caused the result: the offer, audience, creative, spend and timing all played a part.',
  ].join('\n\n');
  const same = db.prepare(`SELECT id FROM kb_cards WHERE store_id = ? AND lower(title) = lower(?)`).get(store.id, title);
  const cardId =
    (same && String(same.id)) ??
    createCard(
      db,
      store.id,
      { categoryId: ensureCategoryPath(db, store.id, ['Product outcomes']), title, summary, body, tags: ['product-research', 'outcome'], type: 'performance_lesson', stage: 'supported', status: 'active', authorId: 'owner', origin: 'owner' },
      now,
    ).id;
  const context = { storeProductId, from: o.period.from, to: o.period.to, offer: o.offer, inventory: o.inventory, audience: all.audience, observed: o.observed };
  db.prepare(`INSERT OR IGNORE INTO pr_outcomes (id, store_id, product_id, kind, ref_id, context_json, created_at) VALUES (?, ?, ?, 'kb_card', ?, ?, ?)`).run(
    randomUUID(), store.id, id, cardId, JSON.stringify(context), now.toISOString(),
  );
  return { cardId, created: !same };
}
