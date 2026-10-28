import type { Db } from '../db';

/**
 * Every limit on metered source calls, in one place (decision 4). CJ's documented limits (docs/features/product-research-
 * sources.md, read 2026-10-28): 1 request/second on a free account, and a daily budget of 50,000 points where a
 * product list costs 50 and a detail, variant, stock or freight call 10. 500 ingestion calls a day stay well inside it
 * (at most 100 list pages = 5,000 points, plus 400 detail calls = 4,000) and leave the rest to the owner's own searches.
 */
export const CAPS = {
  cj: {
    pagesPerQueryPerDay: 5,
    pageSize: 20,
    ingestionCallsPerDay: 500,
    watchCallsPerDay: 100,
    searchPagesPerClick: 1,
    altSupplierCallsPerSearch: 3,
    /** Decision 16: in the dev app (no FRONTLINE_WEB_DIR) this lane's live checks make at most 200 CJ calls in total. */
    devTotal: 200,
  },
  imageFetchesPerMinute: 30,
  /** Retries for a timeout or a server error; none for auth, quota or schema errors. */
  retries: 3,
} as const;

export type CallPurpose = 'token' | 'ingestion' | 'search' | 'watch' | 'order_sync' | 'owner';

const DAILY: Partial<Record<CallPurpose, number>> = { ingestion: CAPS.cj.ingestionCallsPerDay, watch: CAPS.cj.watchCallsPerDay };

const dayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`; // CJ's points reset at 00:00 UTC

/** Calls of one purpose since 00:00 UTC. */
export const callsToday = (db: Db, source: string, purpose: CallPurpose, now = new Date()) =>
  Number(db.prepare('SELECT count(*) AS n FROM pr_calls WHERE source = ? AND purpose = ? AND at >= ?').get(source, purpose, dayStart(now))?.n ?? 0);

const devApp = () => !process.env.FRONTLINE_WEB_DIR;

/**
 * Why a call may not be made now, or undefined when it may. Reserve with `recordCall` before yielding so queued
 * calls count too; failed or interrupted calls retain their reservation.
 */
export function refusal(db: Db, source: string, purpose: CallPurpose, now = new Date()): string | undefined {
  const cap = DAILY[purpose];
  if (cap !== undefined && callsToday(db, source, purpose, now) >= cap) return `Daily ${purpose} limit reached (${cap} calls); it resets at 00:00 UTC.`;
  if (source === 'cj' && devApp() && Number(db.prepare(`SELECT count(*) AS n FROM pr_calls WHERE source = 'cj'`).get()?.n ?? 0) >= CAPS.cj.devTotal) {
    return `The dev app's live-check limit of ${CAPS.cj.devTotal} CJ calls is used up.`;
  }
  return undefined;
}

export const recordCall = (db: Db, source: string, purpose: CallPurpose, ok: boolean, now = new Date()) =>
  db.prepare('INSERT INTO pr_calls (source, purpose, at, ok) VALUES (?, ?, ?, ?)').run(source, purpose, now.toISOString(), ok ? 1 : 0);
