import type { Context } from 'hono';
import type { Db } from '../db';

/**
 * Store isolation for by-id routes (decision 13): given `?store=`, a record of another store answers 404 like a missing
 * one. Without it the route works as before. The store comes from the record, never from the UI.
 */
export const wrongStore = (c: Context, db: Db, table: 'agents' | 'agent_runs' | 'approvals' | 'store_memory' | 'squad_missions' | 'flow_drafts', id: string) => {
  const want = c.req.query('store');
  return want !== undefined && db.prepare(`SELECT store_id FROM ${table} WHERE id = ?`).get(id)?.store_id !== want;
};
