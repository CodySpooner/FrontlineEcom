import { closeAnsweredIssues, listOrderIssues, setIssueStatus } from '@frontline/agents';
import type { OrderIssueStatus } from '@frontline/shared';
import { Hono } from 'hono';
import type { Db } from '../db';

const STATUSES: OrderIssueStatus[] = ['open', 'resolved'];

/** Orders & Fulfillment: the Operations agent's issue queue. */
export function issueRoutes(db: Db) {
  return new Hono()
    .get('/api/order-issues', (c) => {
      const status = c.req.query('status') as OrderIssueStatus | undefined;
      if (status && !STATUSES.includes(status)) return c.json({ error: 'status must be open or resolved' }, 400);
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 100));
      closeAnsweredIssues(db);
      return c.json(listOrderIssues(db, { storeIds: c.req.query('stores')?.split(',').filter(Boolean), status, limit }));
    })
    .patch('/api/order-issues/:id', async (c) => {
      const body = (await c.req.json().catch(() => undefined)) as { status?: unknown; resolution?: unknown } | undefined;
      if (!STATUSES.includes(body?.status as OrderIssueStatus)) return c.json({ error: 'status must be open or resolved' }, 400);
      if (body?.resolution !== undefined && (typeof body.resolution !== 'string' || body.resolution.length > 500)) return c.json({ error: 'resolution must be text up to 500 characters' }, 400);
      const issue = setIssueStatus(db, c.req.param('id'), body!.status as OrderIssueStatus, body?.resolution as string | undefined);
      return issue ? c.json(issue) : c.json({ error: 'Issue not found' }, 404);
    });
}
