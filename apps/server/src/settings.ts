import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import type { AppNotification, NewNotification, NotificationKind, Settings, StoreCaps } from '@frontline/shared';
import { effective, readDoc } from './config/effective';
import { ConfigError, NO_VERSION, versionOf, writeConfig } from './config/write';
import { dataDir, type Db } from './db';
import { publish } from './live';
import { getStore, listStores } from './stores';

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

const DEFAULT_SETTINGS: Omit<Settings, 'dataDir'> = {
  profile: { name: 'Cody', plan: 'Pro Plan' },
  notifications: { approvals: true, agentDone: true, errors: true, digest: true, researchAlerts: true },
  baseCurrency: 'USD',
};

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const extra = (o: Obj, allowed: string[]) => Object.keys(o).find((k) => !allowed.includes(k));

export function getSettings(db: Db): Settings {
  const r = db.prepare("SELECT value_json, version FROM settings WHERE key = 'app'").get();
  const saved: Partial<Settings> = r ? JSON.parse(String(r.value_json)) : {};
  // Fresh objects every call (callers mutate), defaults fill keys added after the row was saved.
  return {
    profile: { ...DEFAULT_SETTINGS.profile, ...saved.profile },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...saved.notifications },
    baseCurrency: saved.baseCurrency ?? DEFAULT_SETTINGS.baseCurrency,
    dataDir: resolve(dataDir()),
    version: r ? Number(r.version) : 0,
  };
}

/**
 * Validates a SettingsUpdate and saves only the keys it sends, through the config writer. Returns an error message or
 * the new Settings. `version` (the `app` row's, as read) is checked when given: a stale one throws ConfigError (409).
 */
export function updateSettings(db: Db, body: unknown, version?: number): string | Settings {
  if (!isObj(body)) return 'body must be a JSON object';
  const bad = extra(body, ['profile', 'notifications', 'baseCurrency']);
  if (bad) return `unknown setting ${bad}`;
  const set: Obj = {};
  if (body.profile !== undefined) {
    if (!isObj(body.profile) || extra(body.profile, ['name', 'plan'])) return 'profile takes name and plan';
    for (const k of ['name', 'plan'] as const) {
      const v = body.profile[k];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 40) return `profile.${k} must be 1-40 characters`;
      set[`profile.${k}`] = v.trim();
    }
  }
  if (body.baseCurrency !== undefined) {
    if (typeof body.baseCurrency !== 'string' || !/^[A-Za-z]{3}$/.test(body.baseCurrency.trim())) return 'baseCurrency must be a 3-letter ISO code';
    set.baseCurrency = body.baseCurrency.trim().toUpperCase();
  }
  if (body.notifications !== undefined) {
    const keys = Object.keys(DEFAULT_SETTINGS.notifications) as (keyof Settings['notifications'])[];
    if (!isObj(body.notifications) || extra(body.notifications, keys)) return `notifications takes ${keys.join(', ')}`;
    for (const k of keys) {
      const v = body.notifications[k];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') return `notifications.${k} must be true or false`;
      set[`notifications.${k}`] = v;
    }
  }
  writeConfig(db, [{ doc: 'app', version, set }], { trusted: true, current: () => getSettings(db) });
  return getSettings(db);
}

/** A store's effective caps: its overrides, else the workspace defaults, else the built-in ones (decision 4). */
export function getCaps(db: Db, storeId: string): StoreCaps {
  const { values } = effective(db, { storeId });
  const row = readDoc(db, 'store_caps', storeId);
  const num = (k: string) => Number(values[`caps.${k}`]);
  return {
    storeId,
    adSpendChangePerDay: num('adSpendChangePerDay'),
    higgsfieldCreditsPerDay: num('higgsfieldCreditsPerDay'),
    agentCostPerDay: num('agentCostPerDay'),
    autopilot: { ...(row.json.autopilot as StoreCaps['autopilot']) },
    version: row.version,
  };
}

/**
 * Validates a StoreCapsUpdate and saves only the keys it sends as store overrides (autopilot per action kind), so an
 * inherited cap is never copied into the store's row. `version` as for updateSettings.
 */
export function updateCaps(db: Db, storeId: string, body: unknown, version?: number): string | StoreCaps {
  if (!isObj(body)) return 'body must be a JSON object';
  const numbers = ['adSpendChangePerDay', 'higgsfieldCreditsPerDay', 'agentCostPerDay'] as const;
  const bad = extra(body, [...numbers, 'autopilot']);
  if (bad) return `unknown cap ${bad}`;
  const okNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e6;
  const set: Obj = {};
  for (const k of numbers) {
    if (body[k] === undefined) continue;
    if (!okNum(body[k])) return `${k} must be a number from 0 to 1000000`;
    set[`caps.${k}`] = body[k];
  }
  if (body.autopilot !== undefined) {
    if (!isObj(body.autopilot)) return 'autopilot must be an object of action kind → { enabled, maxUsdPerDay }';
    for (const [kind, rule] of Object.entries(body.autopilot)) {
      if (!/^[a-z0-9_.]{1,64}$/.test(kind)) return `autopilot action kind ${kind} must match [a-z0-9_.]`;
      if (!isObj(rule) || typeof rule.enabled !== 'boolean' || !okNum(rule.maxUsdPerDay) || extra(rule, ['enabled', 'maxUsdPerDay'])) {
        return `autopilot.${kind} must be { enabled: boolean, maxUsdPerDay: number }`;
      }
      set[`autopilot.${kind}`] = { enabled: rule.enabled, maxUsdPerDay: rule.maxUsdPerDay };
    }
  }
  writeConfig(db, [{ doc: 'store_caps', storeId, version, set }], { trusted: true, current: () => getCaps(db, storeId) });
  return getCaps(db, storeId);
}

/** A config write route: 400 without a JSON object, 428 without the `version` read, 409 when it's stale (decision 6). */
async function versioned(c: Context, write: (body: Obj, version: number) => string | object) {
  const body: unknown = await c.req.json().catch(() => undefined);
  if (!isObj(body)) return c.json({ error: 'body must be a JSON object' }, 400);
  const { version: _, ...rest } = body;
  const version = versionOf(body);
  if (version === undefined) return c.json(NO_VERSION, 428);
  try {
    const out = write(rest, version);
    return typeof out === 'string' ? c.json({ error: out }, 400) : c.json(out);
  } catch (e) {
    if (e instanceof ConfigError) return c.json(e.body, e.status);
    throw e;
  }
}

const toNotification = (r: Row): AppNotification => ({
  id: String(r.id),
  kind: r.kind as NotificationKind,
  title: String(r.title),
  ...(r.body ? { body: String(r.body) } : {}),
  ...(r.store_id ? { storeId: String(r.store_id) } : {}),
  ...(r.link ? { link: String(r.link) } : {}),
  createdAt: String(r.created_at),
  ...(r.read_at ? { readAt: String(r.read_at) } : {}),
});

const PREF: Record<NotificationKind, keyof Settings['notifications'] | undefined> = { approval: 'approvals', agent_done: 'agentDone', error: 'errors', info: undefined, research_alert: 'researchAlerts' };

/** Stores + broadcasts a notification unless the owner turned that kind off. */
export function notify(db: Db, n: NewNotification): AppNotification | undefined {
  const pref = PREF[n.kind];
  if (pref && !getSettings(db).notifications[pref]) return;
  const out: AppNotification = { id: randomUUID(), ...n, createdAt: new Date().toISOString() };
  db.prepare('INSERT INTO notifications (id, kind, title, body, store_id, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    out.id, out.kind, out.title, out.body ?? null, out.storeId ?? null, out.link ?? null, out.createdAt,
  );
  publish({ type: 'notification', notification: out });
  return out;
}

/** Opens a folder in the OS file manager (Explorer on Windows). */
const openFolder = (dir: string) =>
  void spawn(process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open', [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();

export function settingsRoutes(db: Db, open = openFolder) {
  return new Hono()
    .get('/api/settings', (c) => c.json(getSettings(db)))
    // Fixed path, no input: the local UI's "Open data folder" (logs, backups, database).
    .post('/api/settings/open-data-folder', (c) => {
      open(getSettings(db).dataDir);
      return c.body(null, 204);
    })
    .patch('/api/settings', (c) => versioned(c, (body, version) => updateSettings(db, body, version)))
    .get('/api/caps', (c) => {
      const want = c.req.query('stores')?.split(',').filter(Boolean);
      const ids = listStores(db).map((s) => s.id).filter((id) => !want?.length || want.includes(id));
      return c.json(ids.map((id) => getCaps(db, id)));
    })
    .put('/api/caps/:storeId', async (c) => {
      const storeId = c.req.param('storeId');
      if (!getStore(db, storeId)) return c.json({ error: 'store not found' }, 404);
      return versioned(c, (body, version) => updateCaps(db, storeId, body, version));
    })
    .get('/api/notifications', (c) => {
      const unread = c.req.query('unread') === 'true';
      const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
      const rows = db.prepare(`SELECT * FROM notifications ${unread ? 'WHERE read_at IS NULL' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit);
      return c.json(rows.map(toNotification));
    })
    .post('/api/notifications/read', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown };
      const ids = body?.ids;
      if (ids !== undefined && (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string'))) return c.json({ error: 'ids must be an array of strings' }, 400);
      const now = new Date().toISOString();
      const updated = ids
        ? ids.length
          ? db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids).changes
          : 0
        : db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(now).changes;
      return c.json({ updated: Number(updated) });
    });
}
