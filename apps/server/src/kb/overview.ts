import { getCard, kbScope } from '@frontline/agents';
import type { KbCard, KbDiscovery, KbOverview, KbStage, KbWorkspace } from '@frontline/shared';
import type { Db } from '../db';
import { listStores } from '../stores';
import { performanceStatus } from './performance';

// The Research Center's numbers (KB-16), from the visible cards (proposed + active) of one workspace, or all of them.

const DAY = 86_400_000;
const STALE_DAYS = 90; // ponytail: one age for every card, as on the artboard, until per-category freshness (KB-23).
const VISIBLE = `status IN ('proposed', 'active')`;
const GAPS = ['only hypotheses', 'stale', '0 measured'];

interface Group {
  ws: string;
  categoryId: string;
  name: string;
  stages: Record<KbStage, number>;
  stale: number;
  measured: boolean;
}
const total = (g: Pick<Group, 'stages'>) => Object.values(g.stages).reduce((a, b) => a + b, 0);

export function kbOverview(db: Db, ws: KbWorkspace | 'all', now = new Date()): KbOverview {
  const s = kbScope(ws);
  const n = (sql: string) => Number(db.prepare(sql).get(...s.params)!.n);
  const week = new Date(now.getTime() - 7 * DAY).toISOString();
  const cats = db.prepare(`SELECT id, parent_id, name FROM kb_categories WHERE ${s.sql}`).all(...s.params);
  const parent = new Map(cats.map((c) => [String(c.id), c.parent_id ? String(c.parent_id) : undefined]));
  const root = (id: string): string => (parent.get(id) ? root(parent.get(id)!) : id);
  const name = new Map(cats.map((c) => [String(c.id), String(c.name)]));
  const measured = new Set(db.prepare(`SELECT DISTINCT card_id FROM kb_evidence WHERE kind = 'measured' AND card_id IN (SELECT id FROM kb_cards WHERE ${s.sql})`).all(...s.params).map((r) => String(r.card_id)));
  const cards = db.prepare(`SELECT id, store_id, category_id, stage, created_at, coalesce(verified_at, created_at) AS seen FROM kb_cards WHERE ${VISIBLE} AND ${s.sql}`).all(...s.params);

  // Each root category of each workspace, with its cards by stage.
  const groups = new Map<string, Group>();
  const stages: Record<KbStage, number> = { hypothesis: 0, supported: 0, tested: 0, validated: 0 };
  let thisWeek = 0;
  let stale = 0;
  for (const c of cards) {
    const r = root(String(c.category_id));
    if (!groups.has(r)) groups.set(r, { ws: c.store_id ? String(c.store_id) : 'general', categoryId: r, name: name.get(r) ?? '', stages: { hypothesis: 0, supported: 0, tested: 0, validated: 0 }, stale: 0, measured: false });
    const g = groups.get(r)!;
    g.stages[c.stage as KbStage]++;
    stages[c.stage as KbStage]++;
    if (now.getTime() - Date.parse(String(c.seen)) > STALE_DAYS * DAY) {
      g.stale++;
      stale++;
    }
    if (measured.has(String(c.id))) g.measured = true;
    if (String(c.created_at) >= week) thisWeek++;
  }

  // The map adds up same-named roots (All workspaces); a row links to the workspace holding most of them.
  const byName = new Map<string, Group[]>();
  for (const g of groups.values()) byName.set(g.name, [...(byName.get(g.name) ?? []), g]);
  const map = [...byName.values()]
    .map((gs) => {
      const top = gs.reduce((a, b) => (total(b) > total(a) ? b : a));
      const sum = { hypothesis: 0, supported: 0, tested: 0, validated: 0 };
      for (const g of gs) for (const k of Object.keys(sum) as KbStage[]) sum[k] += g.stages[k];
      return { ws: top.ws, categoryId: top.categoryId, name: top.name, stages: sum };
    })
    .sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));

  // Gaps, weakest first: nothing past a hypothesis, then mostly stale, then nothing measured.
  const gapOf = (g: Group) => (g.stages.hypothesis === total(g) ? 'only hypotheses' : g.stale * 2 >= total(g) ? `${g.stale} of ${total(g)} stale` : g.measured ? undefined : '0 measured');
  const rank = (reason: string) => GAPS.findIndex((x) => reason.includes(x));
  const gaps = [...groups.values()]
    .flatMap((g) => {
      const reason = gapOf(g);
      return reason ? [{ ws: g.ws, categoryId: g.categoryId, name: g.name, reason, size: total(g) }] : [];
    })
    .sort((a, b) => rank(a.reason) - rank(b.reason) || b.size - a.size)
    .slice(0, 5)
    .map(({ size: _, ...g }) => g);

  // This week's discoveries: cards that earned Validated, and every conflict and promotion still waiting for the owner.
  const discoveries: KbDiscovery[] = [
    ...db
      .prepare(
        `SELECT card_id, max(created_at) AS at, reason FROM kb_revisions WHERE reason LIKE 'Moved up to Validated%' AND created_at >= ?
         AND card_id IN (SELECT id FROM kb_cards WHERE stage = 'validated' AND ${VISIBLE} AND ${s.sql}) GROUP BY card_id`,
      )
      .all(week, ...s.params)
      .flatMap((r) => {
        const card = getCard(db, String(r.card_id));
        return card ? [{ kind: 'validated' as const, at: String(r.at), reason: String(r.reason).replace(/^Moved up to Validated: /, ''), card }] : [];
      }),
    ...db
      .prepare(`SELECT id, card_id, other_card_id, note, created_at FROM kb_conflicts WHERE status = 'open' AND ${s.sql} ORDER BY created_at DESC LIMIT 8`)
      .all(...s.params)
      .flatMap((r) => {
        const card = getCard(db, String(r.card_id));
        const other: KbCard | undefined = r.other_card_id ? getCard(db, String(r.other_card_id)) : undefined;
        return card ? [{ kind: 'conflict' as const, id: String(r.id), at: String(r.created_at), note: String(r.note), card, ...(other ? { other } : {}) }] : [];
      }),
    // General versions of cards waiting for the owner (KB-18). Requests belong to a store, so General's overview has none.
    ...db
      .prepare(`SELECT id, created_at, action_json FROM approvals WHERE status = 'pending' AND json_extract(action_json, '$.kind') = 'kb.promote' AND ${s.sql}`)
      .all(...s.params)
      .flatMap((r) => {
        const p = JSON.parse(String(r.action_json)).payload as { cardId: string; title: string };
        const card = getCard(db, p.cardId);
        return card ? [{ kind: 'promotion' as const, id: String(r.id), at: String(r.created_at), title: p.title, card }] : [];
      }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const open = db.prepare(`SELECT status, payer_id, role FROM kb_tasks WHERE status IN ('queued', 'running') AND ${s.sql}`).all(...s.params);
  const running = open.filter((t) => t.status === 'running');
  return {
    cards: cards.length,
    thisWeek,
    validated: stages.validated,
    hypotheses: stages.hypothesis,
    supported: stages.supported,
    stale,
    conflicts: n(`SELECT count(*) AS n FROM kb_conflicts WHERE status = 'open' AND ${s.sql}`),
    running: running.length,
    queued: open.length - running.length,
    researchers: new Set(running.map((t) => `${t.payer_id}:${t.role}`)).size,
    sources: n(`SELECT count(*) AS n FROM kb_sources WHERE ${s.sql}`),
    map,
    discoveries,
    gaps,
    performance: ws === null ? [] : listStores(db).filter((st) => ws === 'all' || st.id === ws).map((st) => performanceStatus(db, st.id)),
  };
}
