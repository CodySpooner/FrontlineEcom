import { promotedAs, promotionPending, promotionTask } from '@frontline/agents';
import { AGENT_ROLES, KB_STAGES, type KbStage } from '@frontline/shared';
import { once, type Db } from '../db';
import { listStores } from '../stores';

const STAGES = Object.keys(KB_STAGES) as KbStage[];
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** Who drafts a card's General version: the store's agent that wrote it, else its Market Analyst. */
export function drafter(c: { storeId: string; authorId: string }): string {
  const [store, role] = c.authorId.split(':');
  return store === c.storeId && role && Object.hasOwn(AGENT_ROLES, role) ? c.authorId : `${c.storeId}:market_analyst`;
}

/**
 * The same card found on its own in two or more live stores (≥50% of the words of its title and summary in common) is
 * offered for General once: a run drafts it from the strongest of them. Demo stores' cards come from simulated numbers,
 * so only live stores count, as with proposeNichePromotions.
 */
// ponytail: pairwise word overlap over the live stores' accepted cards; FTS lookups if they grow past a few thousand.
export function proposeKbPromotions(db: Db, start: (agentId: string, task: string) => unknown) {
  const activated = db.prepare('SELECT 1 FROM done_once WHERE ref = ?');
  const live = new Map(listStores(db).filter((s) => s.connected && activated.get(`activate:${s.id}`)).map((s) => [s.id, s.name]));
  const cards = db
    .prepare(`SELECT id, store_id, title, summary, stage, author_id FROM kb_cards WHERE status = 'active' AND store_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify([...live.keys()]))
    .map((r) => ({ id: String(r.id), storeId: String(r.store_id), authorId: String(r.author_id), stage: STAGES.indexOf(r.stage as KbStage), words: words(`${r.title} ${r.summary}`) }))
    .filter((c) => !activated.get(`kb-promote:${c.id}`) && !promotionPending(db, c.id) && !promotedAs(db, c.id));
  const taken = new Set<string>();
  for (const a of cards) {
    if (taken.has(a.id)) continue;
    const same = cards.filter((b) => {
      if (taken.has(b.id) || b.storeId === a.storeId) return false;
      const shared = [...a.words].filter((w) => b.words.has(w)).length;
      return shared / (a.words.size + b.words.size - shared) >= 0.5;
    });
    if (!same.length) continue;
    const group = [a, ...same];
    for (const c of group) {
      taken.add(c.id);
      once(db, `kb-promote:${c.id}`);
    }
    const lead = group.reduce((x, y) => (y.stage > x.stage ? y : x));
    const names = [...new Set([lead, ...group].map((c) => live.get(c.storeId)!))];
    start(drafter(lead), promotionTask(lead.id, `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`));
  }
}

/** The hourly check for cards to offer for General, while the app runs. */
export function startKbPromotionLoop(db: Db, start: (agentId: string, task: string) => unknown, everyMs = 3_600_000) {
  const timer = setInterval(() => proposeKbPromotions(db, start), everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
