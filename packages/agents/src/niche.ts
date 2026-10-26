import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NicheLearning, Store } from '@frontline/shared';

// Custom niches (store.niche 'other') get a pack drafted by the Market Analyst and saved, after approval,
// in the owner's data dir: <FRONTLINE_DATA_DIR>/packs/niche/<slug>.md.

export const nicheSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const customPackPath = (slug: string) => join(process.env.FRONTLINE_DATA_DIR ?? './.data', 'packs', 'niche', `${slug}.md`);

export function customNichePack(nicheDetail?: string): string {
  const slug = nicheDetail && nicheSlug(nicheDetail);
  if (!slug) return '';
  const path = customPackPath(slug);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
}

export function saveNichePack(slug: string, markdown: string): string {
  const path = customPackPath(nicheSlug(slug));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown.trim() + '\n');
  return path;
}

const template = () => readFileSync(new URL('../packs/niche/_template.md', import.meta.url), 'utf8').trim();

/** Market Analyst task: research the custom niche and propose a pack; saving it is an approval. */
export function draftNichePackTask(store: Store): string {
  const niche = store.nicheDetail ?? store.niche;
  return `Draft a niche pack for "${niche}" so the whole squad of ${store.name} works like seasoned operators of this niche.
Research it first (WebSearch/WebFetch): customers, regulations and claim rules, seasonality, price norms, suppliers.
Follow this template exactly, 500-800 words, terse bullets, numbers as typical ranges, rules you are unsure of marked "verify":

${template()}

Then call request_approval with kind "save_niche_pack", title "Save the ${niche} niche pack", a one-line reason,
and payload {"slug": "${nicheSlug(niche)}", "markdown": "<the full pack>"}.`;
}

// Learnings promoted from one store to every store of its niche (owner-approved, see promote_niche_learning).

export const nicheKey = (store: Pick<Store, 'niche' | 'nicheDetail'>) => (store.niche === 'other' ? `other:${nicheSlug(store.nicheDetail ?? '')}` : store.niche);

/** Returns false when the niche already has this learning. */
export function addNicheLearning(db: DatabaseSync, l: Omit<NicheLearning, 'id' | 'createdAt'>, now = new Date()): boolean {
  const r = db
    .prepare('INSERT OR IGNORE INTO niche_learnings (id, niche, text, evidence, store_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), l.niche, l.text.trim(), l.evidence ?? null, l.storeId ?? null, now.toISOString());
  return r.changes > 0;
}

/** Newest first. */
export function listNicheLearnings(db: DatabaseSync, niche?: string, limit = 50): NicheLearning[] {
  return db
    .prepare(`SELECT * FROM niche_learnings ${niche ? 'WHERE niche = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...(niche ? [niche] : []), limit)
    .map((r) => ({
      id: String(r.id), niche: String(r.niche), text: String(r.text), createdAt: String(r.created_at),
      ...(r.evidence ? { evidence: String(r.evidence) } : {}), ...(r.store_id ? { storeId: String(r.store_id) } : {}),
    }));
}

export const deleteNicheLearning = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM niche_learnings WHERE id = ?').run(id).changes > 0;
