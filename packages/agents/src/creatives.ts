import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AspectRatio, Creative, CreativeKind, Store } from '@frontline/shared';

// The creatives library lives in `creatives` (agents-lane migration in apps/server/src/db.ts).

// ponytail: flat demo prices per generation; real per-model costs come from Higgsfield once it is connected (Blocked).
export const CREDITS: Record<CreativeKind, number> = { image: 2, video: 20, ugc: 40, copy: 0 };

export type NewCreative = Omit<Creative, 'id' | 'createdAt'>;

export function saveCreative(db: DatabaseSync, c: NewCreative, now = new Date()): Creative {
  const creative: Creative = { ...c, id: randomUUID(), createdAt: now.toISOString() };
  db.prepare(
    `INSERT INTO creatives (id, store_id, agent_id, run_id, kind, aspect, prompt, headline, primary_text, cta, media_url, credits, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    creative.id, c.storeId, c.agentId, c.runId ?? null, c.kind, c.aspect ?? null, c.prompt ?? null, c.headline, c.primaryText, c.cta ?? null,
    c.mediaUrl ?? null, c.credits, c.source, creative.createdAt,
  );
  return creative;
}

/** Newest first. */
export function listCreatives(db: DatabaseSync, q: { storeIds?: string[]; kind?: CreativeKind; limit?: number } = {}): Creative[] {
  const where: string[] = [];
  const args: string[] = [];
  if (q.storeIds?.length) where.push(`store_id IN (${q.storeIds.map(() => '?').join(',')})`), args.push(...q.storeIds);
  if (q.kind) where.push('kind = ?'), args.push(q.kind);
  return db
    .prepare(`SELECT * FROM creatives ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(...args, q.limit ?? 100)
    .map(toCreative);
}

export const deleteCreative = (db: DatabaseSync, id: string) => db.prepare('DELETE FROM creatives WHERE id = ?').run(id).changes > 0;

/** Generation credits the store spent since local midnight. */
export function creditsToday(db: DatabaseSync, storeId: string): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return Number(db.prepare('SELECT coalesce(sum(credits), 0) AS n FROM creatives WHERE store_id = ? AND created_at >= ?').get(storeId, midnight.toISOString())?.n ?? 0);
}

const SIZE: Record<AspectRatio, [number, number]> = { '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920], '16:9': [1920, 1080] };
const xml = (s: string) => s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Stand-in render for demo mode: the headline on the store's color, at the right aspect ratio. */
export function demoMedia(store: Pick<Store, 'name' | 'color'>, c: { kind: CreativeKind; aspect: AspectRatio; headline: string; cta?: string }) {
  const [w, h] = SIZE[c.aspect];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${xml(store.color)}"/><stop offset="1" stop-color="#111114"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="46%" fill="#fff" font-family="Inter, Arial, sans-serif" font-size="${Math.round(w / 14)}" font-weight="700" text-anchor="middle">${xml(c.headline)}</text>
${c.cta ? `<text x="50%" y="58%" fill="#fff" opacity=".85" font-family="Inter, Arial, sans-serif" font-size="${Math.round(w / 28)}" text-anchor="middle">${xml(c.cta)} →</text>` : ''}
<text x="40" y="${h - 40}" fill="#fff" opacity=".6" font-family="Inter, Arial, sans-serif" font-size="${Math.round(w / 40)}">${xml(store.name)} · demo ${c.kind} render</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function toCreative(r: Record<string, unknown>): Creative {
  const opt = (k: string) => (r[k] == null ? undefined : String(r[k]));
  const [runId, aspect, prompt, cta, mediaUrl] = ['run_id', 'aspect', 'prompt', 'cta', 'media_url'].map(opt);
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...(runId ? { runId } : {}),
    kind: r.kind as CreativeKind,
    ...(aspect ? { aspect: aspect as AspectRatio } : {}),
    ...(prompt ? { prompt } : {}),
    headline: String(r.headline),
    primaryText: String(r.primary_text),
    ...(cta ? { cta } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    credits: Number(r.credits),
    source: r.source as Creative['source'],
    createdAt: String(r.created_at),
  };
}
