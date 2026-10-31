import { anotherShop, INTEGRATION_KINDS, type Health, type Integration, type IntegrationInput, type IntegrationKind, type IntegrationStatus } from '@frontline/shared';
import { ConfigError, logChanges, NO_VERSION, type Moved } from './config/write';
import { AD_ZONES, forgetPlatform, stateOf } from './connectors/common';
import { utcOffset } from './dates';
import { tx, type Db } from './db';
import { decrypt, encrypt } from './secrets';
import { getStore, storeZone } from './stores';

type Row = Record<string, unknown>;

const idOf = (kind: string, storeId?: string | null) => `${kind}:${storeId ?? 'global'}`;

const LOCKED = "Saved credentials can't be unlocked (the app's key was reset). Enter them again.";

/** The row's secrets, or undefined when they were saved under another key (e.g. the desktop app's key was reset). */
function secretsOf(key: Buffer, r: Row) {
  try {
    return decrypt<Record<string, string>>(key, String(r.encrypted_credentials), String(r.id));
  } catch {
    return undefined;
  }
}

const toIntegration = (r: Row, key: Buffer): Integration => {
  const secrets = secretsOf(key, r);
  const error = secrets ? r.error : LOCKED;
  return {
    id: String(r.id),
    kind: r.kind as IntegrationKind,
    ...(r.store_id ? { storeId: String(r.store_id) } : {}),
    status: secrets ? (r.status as IntegrationStatus) : 'error',
    ...(error ? { error: String(error) } : {}),
    settings: JSON.parse(String(r.settings_json)),
    secretsSet: Object.keys(secrets ?? {}),
    updatedAt: String(r.updated_at),
    ...(r.synced_at ? { syncedAt: String(r.synced_at) } : {}),
    version: Number(r.version),
    // Before the first sync finishes, a cursor is the last page Shopify's import saved.
    ...(INTEGRATION_KINDS[r.kind as IntegrationKind]?.category === 'platform' && (r.synced_at || r.cursor)
      ? { backfill: { through: String(r.synced_at ?? r.cursor).slice(0, 10), done: !!r.synced_at } }
      : {}),
  };
};

/** Integrations for the given stores plus all global ones. */
export function listIntegrations(db: Db, key: Buffer, storeIds: string[]): Integration[] {
  return db
    .prepare(`SELECT * FROM integrations WHERE store_id IS NULL ${storeIds.length ? `OR store_id IN (${storeIds.map(() => '?').join(',')})` : ''} ORDER BY kind, store_id`)
    .all(...storeIds)
    .map((r) => ({ ...toIntegration(r, key), ...zoneNotice(db, r) }));
}

/** An ad account or GA4 property whose days run in another timezone than its store's (by today's clocks, so two names for one match). */
function zoneNotice(db: Db, r: Row): { notice?: string } {
  const account = stateOf<string>(db, AD_ZONES).get(String(r.id));
  const store = storeZone(db, r.store_id ? String(r.store_id) : undefined);
  if (!account || !store) return {};
  try {
    const behind = utcOffset(store) - utcOffset(account);
    if (!behind) return {};
    const { name, category } = INTEGRATION_KINDS[r.kind as IntegrationKind];
    const what = category === 'ads' ? 'ad spend covers' : 'sessions cover';
    return { notice: `${name} reports its days in ${account}, ${Math.abs(behind)} h ${behind > 0 ? 'behind' : 'ahead of'} the store's ${store}, so a day's ${what} other hours than its sales.` };
  } catch {
    return {}; // a zone name this machine doesn't know
  }
}

/** Validates and saves (create or update) an integration. Returns an error message or the saved Integration. */
/** The settings naming the shop a platform integration reads: a new value is another shop. */
const AD_ACCOUNT_KEYS: Partial<Record<IntegrationKind, string>> = { meta_ads: 'adAccountId', google_ads: 'customerId', tiktok_ads: 'advertiserId' };

/** In-process callers (oauth, connectors' tests): the error message alone, and no version check. */
export function saveIntegration(db: Db, key: Buffer, body: unknown): string | Integration {
  const saved = putIntegration(db, key, body);
  return 'id' in saved ? saved : saved.error;
}

/** A refusal: `field` is the integration field (or body key) it's about (settings decision 6). It has no `id`, unlike an Integration. */
type Refused = { error: string; field?: string };

/**
 * Validates and saves (create or update) an integration. `version` is the one read (0: not connected yet): a stale one
 * throws ConfigError 409 and nothing is written; null (an HTTP write that sent none) throws 428 once the body is valid;
 * undefined skips the check (in-process). The version moves only when a setting or a secret changes, and each one that
 * does writes a change row: a secret's says "replaced", never its value.
 */
export function putIntegration(db: Db, key: Buffer, body: unknown, version?: number | null): Refused | Integration {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const { kind, storeId, values } = body as Partial<IntegrationInput>;
  if (typeof kind !== 'string' || !Object.hasOwn(INTEGRATION_KINDS, kind)) return { error: `kind must be one of ${Object.keys(INTEGRATION_KINDS).join(', ')}`, field: 'kind' };
  const spec = INTEGRATION_KINDS[kind];
  if (spec.perStore && (typeof storeId !== 'string' || !getStore(db, storeId))) return { error: `${spec.name} needs an existing storeId`, field: 'storeId' };
  if (!spec.perStore && storeId !== undefined) return { error: `${spec.name} is global; omit storeId`, field: 'storeId' };
  if (!values || typeof values !== 'object') return { error: 'values must be an object', field: 'values' };
  const known = new Set(spec.fields.map((f) => f.key));
  for (const [k, v] of Object.entries(values)) {
    if (!known.has(k)) return { error: `unknown field ${k}`, field: k };
    if (typeof v !== 'string' || v.length > 8192) return { error: `${k} must be a string up to 8192 characters`, field: k };
  }

  const id = idOf(kind, storeId);
  const existing = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  const oldSecrets = (existing && secretsOf(key, existing)) ?? {};
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = values[f.key]?.trim() || (f.secret ? oldSecrets[f.key] : undefined);
    if (!v) {
      if (f.optional) continue;
      return { error: `${f.label} is required`, field: f.key };
    }
    (f.secret ? secrets : settings)[f.key] = v;
  }
  // ponytail: the only kind with alternative credentials (Dev Dashboard app, or a pre-2026 custom app's token).
  if (kind === 'shopify' && !(secrets.accessToken || (settings.clientId && secrets.clientSecret))) return { error: 'Enter the client ID and secret (or an Admin API access token)' };
  // Campaigns belong to one store, so an ad account on two would hand them back and forth every sync. Compared as digits:
  // act_123 is 123, and 123-456-7890 is 1234567890.
  const account = AD_ACCOUNT_KEYS[kind];
  const digits = (v = '') => v.replace(/\D/g, '');
  if (account && digits(settings[account])) {
    const taken = db
      .prepare('SELECT s.name, i.settings_json FROM integrations i JOIN stores s ON s.id = i.store_id WHERE i.kind = ? AND i.id != ?')
      .all(kind, id)
      .find((r) => digits((JSON.parse(String(r.settings_json)) as Record<string, string>)[account]) === digits(settings[account]));
    if (taken) return { error: `This ${spec.name} account is already connected to ${taken.name}. An ad account feeds one store: disconnect it there first.`, field: account };
  }
  if (version === null) throw new ConfigError(428, NO_VERSION);
  // A connection deleted elsewhere (disconnected while the form was open) is never silently recreated.
  const current = existing ? Number(existing.version) : 0;
  if (version !== undefined && version !== current)
    throw new ConfigError(409, { error: 'This connection was changed somewhere else while you were editing.', code: version === 0 ? 'exists' : 'stale', current: existing ? toIntegration(existing, key) : null });
  const before: Record<string, string> = existing ? JSON.parse(String(existing.settings_json)) : {};
  const where = spec.perStore ? 'store' : 'workspace';
  const moved = spec.fields.flatMap((f): Moved[] => {
    const [was, now] = f.secret ? [oldSecrets[f.key], secrets[f.key]] : [before[f.key], settings[f.key]];
    if (was === now) return [];
    return [f.secret ? [`${kind}.${f.key}`, undefined, undefined, where, now ? 'replaced' : 'removed'] : [`${kind}.${f.key}`, was ?? null, now ?? null, where]];
  });

  // Before a disconnect, the shop it was (its synced data stays): another shop now still drops that data.
  const was = existing?.settings_json ?? db.prepare('SELECT value_json FROM settings WHERE key = ?').get(`shop:${id}`)?.value_json;
  const old = was ? (JSON.parse(String(was)) as Record<string, string>) : {};
  const otherShop = anotherShop(kind, old, settings);

  tx(db, () => {
    db.prepare(
      `INSERT INTO integrations (id, kind, store_id, status, error, settings_json, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'connected', NULL, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = 'connected', error = NULL, settings_json = excluded.settings_json,
         encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at, version = integrations.version + ?,
         -- Another shop or ad account (non-secret settings changed) backfills from scratch; a new token picks up where it was.
         cursor = CASE WHEN settings_json = excluded.settings_json THEN cursor END`,
    ).run(id, kind, storeId ?? null, JSON.stringify(settings), encrypt(key, secrets, id), new Date().toISOString(), existing && moved.length ? 1 : 0);
    // The previous shop's orders, products and revenue leave now instead of mixing with the new shop's backfill.
    if (otherShop) forgetPlatform(db, storeId!, kind);
    const store = storeId ? getStore(db, storeId) : undefined;
    logChanges(db, { at: new Date().toISOString(), actor: 'owner', store: store && { id: store.id, name: store.name } }, moved);
  });
  return toIntegration(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id)!, key);
}

/**
 * Disconnects; the synced data stays, and which shop it came from is kept for the next connect (see saveIntegration).
 * With `key`, each secret it held writes a "removed" change row.
 */
export function deleteIntegration(db: Db, id: string, key?: Buffer) {
  const r = db.prepare('DELETE FROM integrations WHERE id = ? RETURNING *').get(id);
  if (!r) return false;
  db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run(`shop:${id}`, String(r.settings_json));
  const held = key ? Object.keys(secretsOf(key, r) ?? {}) : [];
  const store = r.store_id ? getStore(db, String(r.store_id)) : undefined;
  logChanges(db, { at: new Date().toISOString(), actor: 'owner', store: store && { id: store.id, name: store.name } }, held.map((k): Moved => [`${r.kind}.${k}`, undefined, undefined, store ? 'store' : 'workspace', 'removed']));
  return true;
}

/** For connectors only: settings + decrypted secrets. Never send this to the client or a log. Undefined = don't sync. */
export function getCredentials(db: Db, key: Buffer, kind: IntegrationKind, storeId?: string): Record<string, string> | undefined {
  const r = db.prepare('SELECT id, settings_json, encrypted_credentials FROM integrations WHERE id = ?').get(idOf(kind, storeId));
  if (!r) return undefined;
  const secrets = secretsOf(key, r);
  if (!secrets) setIntegrationStatus(db, String(r.id), 'error', LOCKED);
  return secrets && { ...JSON.parse(String(r.settings_json)), ...secrets };
}


/** Connectors that rotate tokens save the new ones here, merged into the stored secrets. */
export function updateSecrets(db: Db, key: Buffer, id: string, secrets: Record<string, string>) {
  const r = db.prepare('SELECT id, encrypted_credentials FROM integrations WHERE id = ?').get(id);
  if (r) db.prepare('UPDATE integrations SET encrypted_credentials = ? WHERE id = ?').run(encrypt(key, { ...secretsOf(key, r), ...secrets }, id), id);
}

/** Connectors report health here; shows on the Integrations screen. Never put credentials in `error`. */
export function setIntegrationStatus(db: Db, id: string, status: IntegrationStatus, error?: string) {
  db.prepare('UPDATE integrations SET status = ?, error = ? WHERE id = ?').run(status, error ?? null, id);
}

/** Health: the API is up; each integration's last known sync state. */
export function health(db: Db): Health {
  const connectors = db
    .prepare('SELECT id, kind, store_id, status, error, synced_at FROM integrations ORDER BY id')
    .all()
    .map((r) => ({
      id: String(r.id),
      kind: r.kind as IntegrationKind,
      ...(r.store_id ? { storeId: String(r.store_id) } : {}),
      status: r.status as IntegrationStatus,
      ...(r.error ? { error: String(r.error) } : {}),
      ...(r.synced_at ? { syncedAt: String(r.synced_at) } : {}),
    }));
  // Settings → Data & Backups (settings ST-31): names only, never the key. The desktop app sets both the key and the hint.
  const desktop = !!process.env.FRONTLINE_SECRET_KEY && process.env.FRONTLINE_KEY_SOURCE === 'safe-storage';
  const keyLocation = desktop ? 'safe-storage' : process.env.FRONTLINE_SECRET_KEY ? 'environment' : 'data-dir';
  const dataDirSource = desktop ? 'desktop' : process.env.FRONTLINE_DATA_DIR ? 'env' : 'default';
  return { ok: true, uptimeSec: Math.round(process.uptime()), version: process.env.FRONTLINE_VERSION ?? 'dev', keyLocation, dataDirSource, connectors };
}
