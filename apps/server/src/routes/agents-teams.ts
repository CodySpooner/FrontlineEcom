import { addNote, addParticipant, cancelMission, createTeam, getTeam, resumeStep, type RunManager } from '@frontline/agents';
import { Hono, type Context } from 'hono';
import type { Db } from '../db';
import { publish } from '../live';
import { getStore } from '../stores';
import { runtimes } from './agents-runtimes';

/**
 * Team sessions (decision 12; shared `CreateTeamInput` lists the routes). Each takes `?store=`, and another store's team
 * or conversation is a 404 (decision 13). `advance` starts what a change unblocked and puts the team on the live feed.
 */
export function teamRoutes(db: Db, runs: RunManager, advance: () => void) {
  const mine = (c: Context) => {
    const team = getTeam(db, c.req.param('id')!);
    return team && team.storeId === c.req.query('store') ? team : undefined;
  };
  const missing = (c: Context) => c.json({ error: 'Team not found' }, 404);
  const body = (c: Context) => c.req.json().catch(() => null);
  return new Hono()
    .post('/api/teams', async (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      if (!store) return c.json({ error: 'Store not found' }, 404);
      const made = createTeam(db, store, await body(c), await runtimes());
      if ('status' in made) return c.json({ error: made.error, ...(made.field ? { field: made.field } : {}) }, made.status);
      if (!made.repeated) advance(); // the lead starts planning
      return c.json(getTeam(db, made.team.id), made.repeated ? 200 : 201);
    })
    .get('/api/teams/:id', (c) => {
      const team = mine(c);
      return team ? c.json(team) : missing(c);
    })
    .post('/api/teams/:id/cancel', (c) => {
      if (!mine(c)) return missing(c);
      const team = cancelMission(db, c.req.param('id'), runs.cancel);
      if (!team) return c.json({ error: 'The team has ended.' }, 409);
      publish({ type: 'mission', mission: team });
      return c.json(team);
    })
    .post('/api/teams/:id/notes', async (c) => {
      if (!mine(c)) return missing(c);
      const team = addNote(db, c.req.param('id'), await body(c));
      if ('error' in team) return c.json({ error: team.error }, team.status);
      publish({ type: 'mission', mission: team });
      return c.json(team);
    })
    .post('/api/teams/:id/participants', async (c) => {
      const store = getStore(db, c.req.query('store') ?? '');
      if (!mine(c) || !store) return missing(c);
      const team = addParticipant(db, store, c.req.param('id'), await body(c), await runtimes());
      if ('error' in team) return c.json({ error: team.error, ...(team.field ? { field: team.field } : {}) }, team.status);
      publish({ type: 'mission', mission: team });
      return c.json(team, 201);
    })
    .post('/api/teams/:id/steps/:step/resume', async (c) => {
      if (!mine(c)) return missing(c);
      const b = (await body(c)) as { clientRequestId?: unknown } | null;
      const resumed = resumeStep(db, c.req.param('id'), c.req.param('step'), b?.clientRequestId, runs.start);
      if ('status' in resumed) return c.json({ error: resumed.error }, resumed.status);
      if (!resumed.repeated) advance();
      return c.json(resumed.run, resumed.repeated ? 200 : 201);
    });
}
