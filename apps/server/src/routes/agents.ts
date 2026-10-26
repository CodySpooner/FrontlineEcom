import { ensureSquads, getAgent, listAgents, updateAgent, type ToolEnv } from '@frontline/agents';
import { AUTONOMY_LEVELS, type AgentUpdate, type Page, type ResearchProduct } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { approvalsHook, decide } from '../approvals';
import { localDate } from '../dates';
import type { Db } from '../db';
import { researchRoutes } from '../research';

/** App data + approvals for agent tools. */
export const toolEnv = (db: Db): ToolEnv => ({
  db,
  approvals: approvalsHook(db),
  decide: (id, decision) => decide(db, id, decision),
  research: async (q) => {
    const params = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]])));
    const res = await researchRoutes(db).request(`/api/research?${params}`);
    return ((await res.json()) as Page<ResearchProduct>).items;
  },
  summary: (storeId, range) => {
    const to = localDate();
    return summarize(loadRows(db, [storeId], range, to), { range, to, storeIds: [storeId] });
  },
});

export function agentRoutes(db: Db) {
  ensureSquads(db);
  return new Hono()
    .get('/api/agents', (c) => c.json(listAgents(db, c.req.query('stores')?.split(',').filter(Boolean))))
    .get('/api/agents/:id', (c) => {
      const agent = getAgent(db, c.req.param('id'));
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    })
    .patch('/api/agents/:id', async (c) => {
      const body = (await c.req.json().catch(() => null)) as AgentUpdate | null;
      if (
        !body ||
        (body.enabled !== undefined && typeof body.enabled !== 'boolean') ||
        (body.autonomy !== undefined && !AUTONOMY_LEVELS.includes(body.autonomy)) ||
        (body.autopilotCapUsd !== undefined && !(typeof body.autopilotCapUsd === 'number' && body.autopilotCapUsd >= 0))
      ) {
        return c.json({ error: 'Expected { enabled?: boolean, autonomy?: suggest|ask|autopilot, autopilotCapUsd?: number >= 0 }' }, 400);
      }
      const agent = updateAgent(db, c.req.param('id'), { enabled: body.enabled, autonomy: body.autonomy, autopilotCapUsd: body.autopilotCapUsd });
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    });
}
