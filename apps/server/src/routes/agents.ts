import { createRunManager, ensureSquads, getAgent, listAgents, updateAgent, type RunManager, type ToolEnv } from '@frontline/agents';
import { AGENT_ROLES, AUTONOMY_LEVELS, type AgentUpdate, type Page, type ResearchProduct } from '@frontline/shared';
import { Hono } from 'hono';
import { loadRows, summarize } from '../analytics';
import { approvalsHook, decide } from '../approvals';
import { localDate } from '../dates';
import type { Db } from '../db';
import { researchRoutes } from '../research';
import { getCaps, notify } from '../settings';
import { getStore } from '../stores';
import { publish } from '../live';

/** App data + approvals for agent tools. */
export const toolEnv = (db: Db): ToolEnv => ({
  db,
  approvals: approvalsHook(db),
  decide: (id, decision) => decide(db, id, decision),
  caps: (storeId) => getCaps(db, storeId),
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

const managers = new WeakMap<Db, RunManager>();

/** The app's run manager for this DB: runs stream over the live bus; finished/failed runs notify the owner. */
export function runManager(db: Db): RunManager {
  let manager = managers.get(db);
  if (!manager) {
    manager = createRunManager({
      db,
      env: toolEnv(db),
      store: (id) => getStore(db, id),
      onEvent: (run, event) => publish({ type: 'run_event', runId: run.id, agentId: run.agentId, storeId: run.storeId, event }),
      onRun: (run) => {
        publish({ type: 'run', run });
        const agent = getAgent(db, run.agentId);
        const name = agent ? AGENT_ROLES[agent.role].name : 'Agent';
        const link = `/agents/${run.agentId}`;
        if (run.status === 'done') notify(db, { kind: 'agent_done', title: `${name} finished`, body: run.task, storeId: run.storeId, link });
        if (run.status === 'error') notify(db, { kind: 'error', title: `${name} hit an error`, body: run.error ?? run.task, storeId: run.storeId, link });
      },
    });
    managers.set(db, manager);
  }
  return manager;
}

export function agentRoutes(db: Db) {
  ensureSquads(db);
  runManager(db);
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
        (body.autonomy !== undefined && !AUTONOMY_LEVELS.includes(body.autonomy))
      ) {
        return c.json({ error: 'Expected { enabled?: boolean, autonomy?: suggest|ask|autopilot }' }, 400);
      }
      const agent = updateAgent(db, c.req.param('id'), { enabled: body.enabled, autonomy: body.autonomy });
      return agent ? c.json(agent) : c.json({ error: 'Agent not found' }, 404);
    });
}
