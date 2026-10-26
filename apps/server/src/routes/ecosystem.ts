import { Hono } from 'hono';
import { OFFICE_DESKS, OFFICE_GRID, type OfficeAppearance, type OfficeSeat } from '@frontline/shared';
import type { Db } from '../db';

const DEFAULT_LOOK: OfficeAppearance = { color: '#ff2a3a', hair: 0, skin: 0, outfit: 'jacket', accessory: 'headset' };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max;
const validLook = (v: unknown): v is OfficeAppearance => object(v) && typeof v.color === 'string' && /^#[\da-f]{6}$/i.test(v.color)
  && integer(v.hair, 6) && integer(v.skin, 4) && ['jacket', 'suit', 'hoodie'].includes(String(v.outfit)) && ['none', 'headset', 'glasses'].includes(String(v.accessory));

function seat(r: Record<string, unknown>): OfficeSeat {
  return { agentId: String(r.agent_id), deskId: String(r.desk_id), displayName: String(r.display_name), appearance: JSON.parse(String(r.appearance_json)),
    position: r.position_json ? JSON.parse(String(r.position_json)) : null, archived: !!r.archived, updatedAt: String(r.updated_at) };
}

export function ecosystemRoutes(db: Db) {
  const get = (id: string) => { const r = db.prepare('SELECT * FROM ecosystem_seats WHERE agent_id = ?').get(id); return r && seat(r); };
  return new Hono()
    .get('/api/ecosystem/seats', (c) => c.json(db.prepare('SELECT * FROM ecosystem_seats ORDER BY desk_id, agent_id').all().map(seat)))
    .post('/api/ecosystem/seats', async (c) => {
      const body: unknown = await c.req.json().catch(() => null);
      if (!object(body) || typeof body.agentId !== 'string' || !OFFICE_DESKS.some((d) => d.id === body.deskId)) return c.json({ error: 'Choose an existing agent and one of the 30 office desks.' }, 400);
      if (!db.prepare('SELECT 1 FROM agents WHERE id = ?').get(body.agentId)) return c.json({ error: 'Agent not found' }, 404);
      const old = get(body.agentId);
      if (old && !old.archived) return c.json({ error: 'This agent already has a workstation.' }, 409);
      const name = body.displayName ?? old?.displayName ?? '';
      const look = body.appearance ?? old?.appearance ?? DEFAULT_LOOK;
      if (typeof name !== 'string' || name.trim().length > 60 || !validLook(look)) return c.json({ error: 'Use a name up to 60 characters and a supported appearance.' }, 400);
      if (Number(db.prepare('SELECT count(*) AS n FROM ecosystem_seats WHERE archived = 0').get()!.n) >= OFFICE_DESKS.length) return c.json({ error: 'Office full: archive a worker to free a desk.' }, 409);
      if (db.prepare('SELECT 1 FROM ecosystem_seats WHERE desk_id = ? AND archived = 0').get(String(body.deskId))) return c.json({ error: 'That workstation is occupied.' }, 409);
      db.prepare(`INSERT INTO ecosystem_seats (agent_id, desk_id, display_name, appearance_json, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET desk_id = excluded.desk_id, display_name = excluded.display_name,
        appearance_json = excluded.appearance_json, position_json = NULL, archived = 0, updated_at = excluded.updated_at`)
        .run(body.agentId, String(body.deskId), name.trim(), JSON.stringify(look), new Date().toISOString());
      return c.json(get(body.agentId), 201);
    })
    .patch('/api/ecosystem/seats/:id', async (c) => {
      const old = get(c.req.param('id'));
      if (!old) return c.json({ error: 'Seat not found' }, 404);
      const body: unknown = await c.req.json().catch(() => null);
      if (!object(body) || !Object.keys(body).length || Object.keys(body).some((k) => !['deskId', 'displayName', 'appearance', 'position'].includes(k))) return c.json({ error: 'Expected deskId, displayName, appearance or position.' }, 400);
      const next = { ...old, ...body };
      if (typeof next.displayName !== 'string' || next.displayName.trim().length > 60 || !validLook(next.appearance) || !OFFICE_DESKS.some((d) => d.id === next.deskId)
        || (next.position !== null && (!object(next.position) || !integer(next.position.x, OFFICE_GRID.width) || !integer(next.position.y, OFFICE_GRID.height)))) return c.json({ error: 'Invalid desk, name, appearance or office tile.' }, 400);
      if (!old.archived && db.prepare('SELECT 1 FROM ecosystem_seats WHERE desk_id = ? AND archived = 0 AND agent_id != ?').get(next.deskId, old.agentId)) return c.json({ error: 'That workstation is occupied.' }, 409);
      const position = old.deskId === next.deskId ? next.position : null;
      db.prepare('UPDATE ecosystem_seats SET desk_id = ?, display_name = ?, appearance_json = ?, position_json = ?, updated_at = ? WHERE agent_id = ?')
        .run(next.deskId, next.displayName.trim(), JSON.stringify(next.appearance), position ? JSON.stringify(position) : null, new Date().toISOString(), old.agentId);
      return c.json(get(old.agentId));
    })
    .delete('/api/ecosystem/seats/:id', (c) => {
      const id = c.req.param('id');
      if (!get(id)) return c.json({ error: 'Seat not found' }, 404);
      db.prepare('UPDATE ecosystem_seats SET archived = 1, updated_at = ? WHERE agent_id = ?').run(new Date().toISOString(), id);
      return c.json(get(id));
    });
}
