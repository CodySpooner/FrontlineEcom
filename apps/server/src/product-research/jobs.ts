import { randomUUID } from 'node:crypto';
import type { PrErrorKind } from '@frontline/shared';
import { once, tx, type Db } from '../db';
import { log } from '../log';
import { CAPS, refusal } from './caps';
import { decayPass, refreshProduct } from './evaluate';
import { refreshAllOrders } from './evidence';
import { SourceError, type PrAdapter } from './sources/adapter';

/*
 * Ingestion as recoverable jobs (spec §13, decision 4): Retrieve → Validate → Normalize → Match/Deduplicate → Store
 * Evidence page by page, each page committed with its checkpoint, so a restart or a failure resumes where it stopped.
 * Evaluate, Enrich and Rank run on what a job stored (`onStored`). Adapters record each call they make in pr_calls
 * (a page may take a token call too).
 */

type Checkpoint = { queries: string[]; q: number; page: number; pagesToday: number; day: string };
type SourceRow = { status: string; error_kind: string | null; updated_at: string; schema_hash: string | null };

const STOPS: PrErrorKind[] = ['auth', 'quota', 'schema'];
const day = (d: Date) => d.toISOString().slice(0, 10);

const sourceRow = (db: Db, id: string) => db.prepare('SELECT status, error_kind, updated_at, schema_hash FROM pr_sources WHERE id = ?').get(id) as SourceRow | undefined;

export function markSource(db: Db, id: string, s: { ok: true } | { ok: false; kind: PrErrorKind; error: string }, now = new Date()) {
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO pr_sources (id, status, last_attempt_at, last_success_at, last_error, error_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = excluded.status, last_attempt_at = excluded.last_attempt_at,
       last_success_at = coalesce(excluded.last_success_at, last_success_at), last_error = excluded.last_error, error_kind = excluded.error_kind, updated_at = excluded.updated_at`,
  ).run(id, s.ok ? 'ok' : STOPS.includes(s.kind) ? 'stopped' : 'degraded', at, s.ok ? at : null, s.ok ? null : s.error, s.ok ? null : s.kind, at);
}

/**
 * Why a stopped source must not be called now: an auth failure until the owner saves new credentials, a used-up quota
 * until 00:00 UTC, a schema change until the owner asks for a sync again (which clears it).
 */
export function stoppedReason(db: Db, adapter: Pick<PrAdapter, 'id' | 'credentialsAt'>, now = new Date()): string | undefined {
  const s = sourceRow(db, adapter.id);
  if (s?.status !== 'stopped') return;
  if (s.error_kind === 'quota') return day(new Date(s.updated_at)) === day(now) ? 'Daily quota used up; it resets at 00:00 UTC.' : undefined;
  if (s.error_kind === 'auth') {
    const saved = adapter.credentialsAt?.(db);
    return saved && saved > s.updated_at ? undefined : 'The credentials were refused: enter them again in Integrations.';
  }
  return 'The source changed its data format: the app stopped reading it and kept its last good data.';
}

/**
 * "Sync now" (PR-11): today's planned queries as jobs, now. The owner asking clears a schema stop (they've looked);
 * an auth stop still waits for new credentials and a quota stop for 00:00 UTC. One sync per source at a time.
 */
export function syncNow(db: Db, a: PrAdapter, key: Buffer, now = new Date()): { error: string } | { jobs: number } {
  if (!a.plan || !a.page) return { error: `${a.name} has nothing to sync.` };
  if (!a.ready?.(db, key)) return { error: `${a.name} isn't set up yet. ${a.connect}` };
  if (db.prepare(`SELECT 1 FROM pr_jobs WHERE source = ? AND status IN ('queued', 'running')`).get(a.id)) return { error: `${a.name} is already syncing.` };
  if (sourceRow(db, a.id)?.error_kind === 'schema') db.prepare(`UPDATE pr_sources SET status = 'degraded', updated_at = ? WHERE id = ?`).run(now.toISOString(), a.id);
  const stop = stoppedReason(db, a, now);
  if (stop) return { error: stop };
  const plans = a.plan(db).filter((p) => p.queries.length);
  if (!plans.length) return { error: "No queries to run: no store has a niche, an included category or a saved keyword that maps to this source." };
  for (const p of plans) enqueue(db, { kind: 'ingest', source: a.id, storeId: p.storeId, queries: p.queries }, now);
  return { jobs: plans.length };
}

export function enqueue(db: Db, j: { kind: string; source: string; storeId: string | null; queries: string[] }, now = new Date()) {
  const id = randomUUID();
  const cp: Checkpoint = { queries: j.queries, q: 0, page: 1, pagesToday: 0, day: day(now) };
  db.prepare(`INSERT INTO pr_jobs (id, kind, source, store_id, status, checkpoint_json, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`).run(id, j.kind, j.source, j.storeId, JSON.stringify(cp), now.toISOString());
  return id;
}

const backoffMs = (attempt: number) => 30_000 * 4 ** (attempt - 1); // 30 s, 2 min, 8 min

/** Removed fields are a schema change; added ones aren't (a source may grow). The fingerprint is the sorted key list. */
const fingerprint = (items: Record<string, unknown>[]) => [...new Set(items.flatMap((i) => Object.keys(i)))].sort().join(',');

export interface RunDeps {
  key: Buffer;
  now?: () => Date;
  /** Evaluate, Enrich and Rank for what a page stored. */
  onStored?: (productIds: string[]) => void;
}

/** Runs one job until it finishes, fails, waits (rate limit, retry) or stops its source. Resumes from its checkpoint. */
export async function runJob(db: Db, jobId: string, adapter: PrAdapter, deps: RunDeps): Promise<string> {
  const now = deps.now ?? (() => new Date());
  const job = db.prepare('SELECT * FROM pr_jobs WHERE id = ?').get(jobId);
  if (!job || job.status !== 'queued' || !adapter.page || !adapter.ingest) return String(job?.status ?? 'missing');
  const stop = stoppedReason(db, adapter, now());
  if (stop) {
    db.prepare(`UPDATE pr_jobs SET status = 'stopped', error = ?, finished_at = ? WHERE id = ?`).run(stop, now().toISOString(), jobId);
    return 'stopped';
  }
  const cp = JSON.parse(String(job.checkpoint_json)) as Checkpoint;
  let attempts = Number(job.attempts);
  if (cp.day !== day(now())) Object.assign(cp, { day: day(now()), pagesToday: 0 });
  db.prepare(`UPDATE pr_jobs SET status = 'running', started_at = coalesce(started_at, ?) WHERE id = ?`).run(now().toISOString(), jobId);
  const set = (status: string, extra: { error?: string | null; next?: string | null; attempts?: number } = {}) =>
    db
      .prepare(`UPDATE pr_jobs SET status = ?, error = ?, next_attempt_at = ?, attempts = coalesce(?, attempts), checkpoint_json = ?, finished_at = ? WHERE id = ?`)
      .run(status, extra.error ?? null, extra.next ?? null, extra.attempts ?? null, JSON.stringify(cp), ['done', 'failed', 'stopped'].includes(status) ? now().toISOString() : null, jobId);

  while (cp.q < cp.queries.length) {
    if (cp.pagesToday >= CAPS.cj.pagesPerQueryPerDay) {
      Object.assign(cp, { q: cp.q + 1, page: 1, pagesToday: 0 });
      continue;
    }
    const purpose = 'ingestion';
    const refused = refusal(db, adapter.id, purpose, now());
    if (refused) {
      set('queued', { error: refused, next: `${day(new Date(now().getTime() + 86_400_000))}T00:05:00.000Z` });
      return 'waiting';
    }
    let res: Awaited<ReturnType<NonNullable<PrAdapter['page']>>>;
    try {
      res = await adapter.page({ db, key: deps.key, query: cp.queries[cp.q]!, page: cp.page, purpose });
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError('server', e instanceof Error ? e.message : String(e));
      markSource(db, adapter.id, { ok: false, kind: err.kind, error: err.message }, now());
      log('error', 'product research source failed', { source: adapter.id, kind: err.kind, error: err.message });
      if (STOPS.includes(err.kind)) {
        set('stopped', { error: err.message });
        return 'stopped';
      }
      attempts += 1;
      if (attempts > CAPS.retries || err.kind === 'request' || err.kind === 'not_found') {
        set('failed', { error: err.message, attempts });
        return 'failed';
      }
      const wait = err.kind === 'rate_limit' ? (err.retryAfterMs ?? 60_000) : backoffMs(attempts);
      set('queued', { error: err.message, attempts, next: new Date(now().getTime() + wait).toISOString() });
      return 'waiting';
    }
    const items = res.items as Record<string, unknown>[];
    const missing = adapter.required?.find((f) => items.some((i) => i[f] === undefined || i[f] === null));
    const prior = sourceRow(db, adapter.id)?.schema_hash;
    const shape = items.length ? fingerprint(items) : prior;
    const removed = prior && shape ? prior.split(',').filter((k) => !shape.split(',').includes(k)) : [];
    if (missing || removed.length) {
      const error = missing ? `Required field "${missing}" missing from ${adapter.name}'s data.` : `${adapter.name} stopped sending: ${removed.join(', ')}.`;
      markSource(db, adapter.id, { ok: false, kind: 'schema', error }, now());
      set('stopped', { error });
      return 'stopped';
    }
    const stored = tx(db, () => {
      const at = now().toISOString();
      const ids = items.map((i) => adapter.ingest!(db, i as never, at));
      Object.assign(cp, res.more ? { page: cp.page + 1, pagesToday: cp.pagesToday + 1 } : { q: cp.q + 1, page: 1, pagesToday: 0 });
      db.prepare('UPDATE pr_jobs SET checkpoint_json = ?, attempts = 0 WHERE id = ?').run(JSON.stringify(cp), jobId);
      return ids;
    });
    attempts = 0;
    markSource(db, adapter.id, { ok: true }, now());
    if (shape) db.prepare('UPDATE pr_sources SET schema_hash = ? WHERE id = ?').run(shape, adapter.id);
    deps.onStored?.(stored);
  }
  set('done');
  return 'done';
}

/** After a restart a job left running resumes from its checkpoint. */
export const requeueRunning = (db: Db) => db.prepare(`UPDATE pr_jobs SET status = 'queued' WHERE status = 'running'`).run();

/** One due job per source at a time, oldest first. */
export async function runDue(db: Db, adapters: PrAdapter[], deps: RunDeps) {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  for (const a of adapters) {
    const due = db
      .prepare(`SELECT id FROM pr_jobs WHERE source = ? AND status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1`)
      .get(a.id, now)?.id;
    if (due) await runJob(db, String(due), a, deps);
  }
}

/** Once a UTC day per scheduled source: its planned queries as jobs. A source that isn't set up or is stopped plans nothing. */
export function planToday(db: Db, adapters: PrAdapter[], key: Buffer, now = new Date()) {
  for (const a of adapters) {
    if (!a.plan || !a.page || a.refreshHours === undefined || !a.ready?.(db, key) || stoppedReason(db, a, now)) continue;
    if (!once(db, `pr:plan:${a.id}:${day(now)}`)) continue;
    for (const p of a.plan(db)) if (p.queries.length) enqueue(db, { kind: 'ingest', source: a.id, storeId: p.storeId, queries: p.queries }, now);
  }
}

/**
 * The ingestion timer, in the competitor-watch shape: hourly, one tick at a time, never on page render. Off in the dev
 * app (no FRONTLINE_WEB_DIR) unless PR_INGEST=1, so a dev server never spends the owner's source quota by itself.
 */
export function startPrJobs(db: Db, key: Buffer, adapters: PrAdapter[], onStored?: (productIds: string[]) => void) {
  requeueRunning(db);
  if (!process.env.FRONTLINE_WEB_DIR && process.env.PR_INGEST !== '1') return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      planToday(db, adapters, key);
      refreshAllOrders(db);
      if (once(db, `pr:decay:${day(new Date())}`)) decayPass(db);
      await runDue(db, adapters, { key, onStored: onStored ?? ((ids) => new Set(ids).forEach((id) => refreshProduct(db, id))) });
      for (const a of adapters) if (a.enrich && a.ready?.(db, key) && !stoppedReason(db, a)) await a.enrich(db, key);
    } catch (e) {
      log('error', 'product research jobs failed', { error: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), 3_600_000);
  void tick();
}
