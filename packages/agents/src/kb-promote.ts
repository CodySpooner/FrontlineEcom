import type { DatabaseSync } from 'node:sqlite';
import type { KbCard, KbPromotion } from '@frontline/shared';
import { createCard, ensureCategoryPath, getCard } from './kb';
import { createLink } from './kb-links';

// Promote to General (KB-18): a store card an agent rewrote to hold for any store becomes General knowledge once the
// owner approves (approvals kind 'kb.promote', carried out by the server's onApproved), Derived From the store card.

/** The General card a store card was promoted to, if it was. */
export function promotedAs(db: DatabaseSync, cardId: string): KbCard | undefined {
  const r = db
    .prepare(`SELECT l.from_id FROM kb_links l JOIN kb_cards g ON g.id = l.from_id AND g.store_id IS NULL WHERE l.to_id = ? AND l.type = 'derived_from' AND l.status = 'confirmed'`)
    .get(cardId);
  return r && getCard(db, String(r.from_id));
}

/** A promotion of the card waiting for the owner. */
export const promotionPending = (db: DatabaseSync, cardId: string) =>
  !!db.prepare(`SELECT 1 FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') = 'kb.promote' AND json_extract(action_json, '$.payload.cardId') = ?`).get(cardId);

/** What a drafting run is asked: rewrite the card for General and send it with propose_general. */
export const promotionTask = (cardId: string, foundIn?: string) =>
  `Promote [kb:${cardId}] to the owner's General knowledge${foundIn ? ` (found on its own in ${foundIn})` : ''}: rewrite it to hold for any of their stores, with no store or product names, prices, customers or numbers only this store has, and send it with propose_general. If it only holds for this store, say why and send nothing.`;

/**
 * An approved promotion of `storeId`'s card: a General card in the same category path, starting as a Hypothesis (one
 * store's evidence isn't evidence it holds in others), Derived From the store card. A General card with that title
 * already there gets the link instead of a twin. Nothing for another store's card or one that's gone.
 */
export function promoteToGeneral(db: DatabaseSync, storeId: string, p: KbPromotion, authorId: string, now = new Date()): KbCard | undefined {
  const source = getCard(db, p.cardId, storeId);
  if (!source) return undefined;
  const same = db.prepare('SELECT id FROM kb_cards WHERE store_id IS NULL AND lower(title) = lower(?)').get(p.title);
  const general = same
    ? getCard(db, String(same.id))!
    : createCard(
        db,
        null,
        { categoryId: ensureCategoryPath(db, null, source.path), title: p.title, summary: p.summary, body: p.body ?? '', type: source.type, stage: 'hypothesis', status: 'active', authorId, origin: 'promotion' },
        now,
      );
  createLink(db, storeId, { from: general.id, to: source.id, type: 'derived_from', why: 'Promoted to General from this card', authorId, status: 'confirmed' }, now);
  return general;
}
