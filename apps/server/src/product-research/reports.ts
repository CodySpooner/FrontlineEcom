import { randomUUID } from 'node:crypto';
import { autoSave, captureFinding } from '@frontline/agents';
import { PR_RECOMMENDATION_LABEL, type PrReport, type PrReportBody } from '@frontline/shared';
import type { Db } from '../db';

/** A report that is research: neither the scripted engine's nor the demo runtime's (decision 7). Columns of pr_reports. */
export const REAL_REPORT = `engine != 'scripted' AND runtime IS NOT 'demo'`;

// The facts' references (taskMessage), wherever a source names one.
const REF = /\b(listing|offer|set):([\w-]+)/g;
const FIXTURE: Record<string, string> = {
  listing: `SELECT origin IN ('fixture', 'legacy_sample') AS bad FROM pr_listings WHERE id = ?`,
  offer: `SELECT provenance = 'fixture' AS bad FROM pr_offers WHERE id = ?`,
  set: `SELECT origin = 'fixture' AS bad FROM pr_signals WHERE id = ?`,
};

/**
 * save_research_report's server half (decision 7). Product, listing and conversation come from the task row; only the
 * run the task started (AI Agents' retries move it, watchTasks) in the task's store may save, once.
 */
export function saveReport(db: Db, taskId: string, body: PrReportBody, run: { runId?: string; storeId: string; scripted: boolean }, now = new Date()): string {
  const t = db.prepare('SELECT product_id, store_id, run_id FROM pr_tasks WHERE id = ?').get(taskId);
  if (!t || t.store_id !== run.storeId) return `Not saved: there is no research task ${taskId} in this store.`;
  if (!run.runId || t.run_id !== run.runId) return `Not saved: only the run research task ${taskId} started can report on it.`;
  if (db.prepare('SELECT 1 FROM pr_reports WHERE run_id = ?').get(run.runId)) return 'Report already saved for this run.';
  const sources = [...body.evidence.map((e) => e.source), ...body.supplier_offers.map((o) => o.offer)];
  for (const source of sources) {
    if (/\bfixture\b/i.test(source)) return `Not saved: "${source}" is a test fixture, not evidence. Leave it out or say what is unknown.`;
    for (const [ref, kind, id] of source.matchAll(REF)) {
      const row = db.prepare(FIXTURE[kind!]!).get(id!);
      if (!row) return `Not saved: ${ref} is not one of the task's facts.`;
      if (row.bad) return `Not saved: ${ref} is test fixture or demo data, not evidence. Leave it out or say what is unknown.`;
    }
  }
  const r = db.prepare('SELECT runtime, agent_id FROM agent_runs WHERE id = ?').get(run.runId);
  const runtime = r?.runtime ?? null;
  db.prepare(
    `INSERT INTO pr_reports (id, store_id, task_id, product_id, run_id, runtime, engine, recommendation, report_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), run.storeId, taskId, String(t.product_id), run.runId, runtime as string | null, run.scripted ? 'scripted' : 'model', body.recommendation, JSON.stringify(body), now.toISOString());
  if (!run.scripted && runtime !== 'demo' && autoSave(db, run.storeId)) captureFindings(db, run.storeId, body, { agentId: String(r?.agent_id ?? `${run.storeId}:product_hunter`), runId: run.runId }, now);
  return run.scripted
    ? 'Report saved as a demo: Product Research shows it as a scripted example, not research.'
    : `Report saved (${PR_RECOMMENDATION_LABEL[body.recommendation]}); the owner sees it on the product's Research tab.`;
}

/**
 * PR-23: a model report's sourced claims (research or measured, with a web link) go to the store's Knowledge Base as
 * findings through `captureFinding`: deduped against the store and General, unreviewed (never given to agents until the
 * owner accepts one), at most 5 a report. A demo report never gets here. Recommendations stay in the report.
 */
function captureFindings(db: Db, storeId: string, body: PrReportBody, by: { agentId: string; runId: string }, now: Date) {
  const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
  const sourced = body.evidence.filter((e): e is typeof e & { kind: 'research' | 'measured' } => (e.kind === 'research' || e.kind === 'measured') && /https?:\/\//.test(e.source)).slice(0, 5);
  for (const e of sourced) {
    const urls = e.source.match(/https?:\/\/\S+/g) ?? [];
    captureFinding(db, storeId, { title: clip(e.claim, 120), summary: e.claim, tag: e.kind, sources: urls }, { ...by, unreviewed: true }, now);
  }
}

/** Every report on the product in the store, newest first: a new one never hides an older one. */
export function productReports(db: Db, storeId: string, productId: string): PrReport[] {
  return db
    .prepare(
      `SELECT r.*, t.conversation_id FROM pr_reports r JOIN pr_tasks t ON t.id = r.task_id WHERE r.store_id = ? AND r.product_id = ? ORDER BY r.created_at DESC, r.rowid DESC`,
    )
    .all(storeId, productId)
    .map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      runId: String(r.run_id),
      conversationId: r.conversation_id == null ? null : String(r.conversation_id),
      runtime: r.runtime == null ? null : String(r.runtime),
      demo: r.engine === 'scripted' || r.runtime === 'demo',
      createdAt: String(r.created_at),
      body: JSON.parse(String(r.report_json)) as PrReportBody,
    }));
}

/** The latest real report's risks and proposals, and whether a real report has measured evidence (decision 11). */
export function reportAssessment(db: Db, storeId: string, productId: string) {
  const latest = db
    .prepare(`SELECT report_json, created_at FROM pr_reports WHERE store_id = ? AND product_id = ? AND ${REAL_REPORT} ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(storeId, productId);
  const body = latest && (JSON.parse(String(latest.report_json)) as PrReportBody);
  const measured = !!db
    .prepare(`SELECT 1 FROM pr_reports r, json_each(r.report_json, '$.evidence') e WHERE r.store_id = ? AND r.product_id = ? AND ${REAL_REPORT} AND json_extract(e.value, '$.kind') = 'measured'`)
    .get(storeId, productId);
  return { report: body ? { createdAt: String(latest!.created_at), risks: body.risks, proposals: body.proposals } : null, measured };
}
