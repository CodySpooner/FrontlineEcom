import { deletePageDraft, getPageDraft, listPageDrafts } from '@frontline/agents';
import type { PageDraftStatus } from '@frontline/shared';
import { Hono } from 'hono';
import { decide } from '../approvals';
import type { Db } from '../db';
import { publishDraft, type PushPage } from './agents-actions';

const STATUSES: PageDraftStatus[] = ['draft', 'pending', 'approved', 'published', 'rejected'];

/** Store Builder: the Store Developer's drafts. */
export function pageRoutes(db: Db, push: PushPage) {
  return new Hono()
    .get('/api/page-drafts', (c) => {
      const status = c.req.query('status') as PageDraftStatus | undefined;
      if (status && !STATUSES.includes(status)) return c.json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
      const limit = Math.min(200, Math.max(1, Math.floor(Number(c.req.query('limit'))) || 100));
      return c.json(listPageDrafts(db, { storeIds: c.req.query('stores')?.split(',').filter(Boolean), status, limit }));
    })
    .get('/api/page-drafts/:id', (c) => {
      const d = getPageDraft(db, c.req.param('id'));
      return d ? c.json(d) : c.json({ error: 'Draft not found' }, 404);
    })
    // The owner publishes: a pending request is approved (the approvals watcher publishes it); a plain draft publishes now,
    // and so does an approved one whose push failed (a platform error), which nothing else would retry.
    .post('/api/page-drafts/:id/publish', async (c) => {
      const d = getPageDraft(db, c.req.param('id'));
      if (!d) return c.json({ error: 'Draft not found' }, 404);
      if (d.status === 'published') return c.json({ error: 'Already published' }, 409);
      if (d.status === 'pending') {
        decide(db, d.approvalId!, 'approve');
        return c.json(getPageDraft(db, d.id), 202);
      }
      await publishDraft(db, d, push);
      return c.json(getPageDraft(db, d.id));
    })
    .delete('/api/page-drafts/:id', (c) => {
      const d = getPageDraft(db, c.req.param('id'));
      if (!d) return c.json({ error: 'Draft not found' }, 404);
      // Discarding it is the owner's no: a publish request still waiting would otherwise approve into nothing.
      if (d.status === 'pending' && d.approvalId) decide(db, d.approvalId, 'deny', 'The owner discarded the draft in the Store Builder.');
      deletePageDraft(db, d.id);
      return c.body(null, 204);
    });
}
