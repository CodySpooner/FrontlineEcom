import { INTEGRATION_KINDS, type Health, type Integration, type IntegrationInput, type IntegrationKind, type IntegrationStatus } from '@frontline/shared';
import type { Db } from './db';
import { decrypt, encrypt } from './secrets';
import { getStore } from './stores';

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
    .map((r) => toIntegration(r, key));
}

/** Validates and saves (create or update) an integration. Returns an error message or the saved Integration. */
export function saveIntegration(db: Db, key: Buffer, body: unknown): string | Integration {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const { kind, storeId, values } = body as Partial<IntegrationInput>;
  if (typeof kind !== 'string' || !Object.hasOwn(INTEGRATION_KINDS, kind)) return `kind must be one of ${Object.keys(INTEGRATION_KINDS).join(', ')}`;
  const spec = INTEGRATION_KINDS[kind];
  if (spec.perStore && (typeof storeId !== 'string' || !getStore(db, storeId))) return `${spec.name} needs an existing storeId`;
  if (!spec.perStore && storeId !== undefined) return `${spec.name} is global; omit storeId`;
  if (!values || typeof values !== 'object') return 'values must be an object';
  const known = new Set(spec.fields.map((f) => f.key));
  for (const [k, v] of Object.entries(values)) {
    if (!known.has(k)) return `unknown field ${k}`;
    if (typeof v !== 'string' || v.length > 8192) return `${k} must be a string up to 8192 characters`;
  }

  const id = idOf(kind, storeId);
  const existing = db.prepare('SELECT id, encrypted_credentials FROM integrations WHERE id = ?').get(id);
  const oldSecrets = (existing && secretsOf(key, existing)) ?? {};
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = values[f.key]?.trim() || (f.secret ? oldSecrets[f.key] : undefined);
    if (!v) {
      if (f.optional) continue;
      return `${f.label} is required`;
    }
    (f.secret ? secrets : settings)[f.key] = v;
  }
  // ponytail: the only kind with alternative credentials (Dev Dashboard app, or a pre-2026 custom app's token).
  if (kind === 'shopify' && !(secrets.accessToken || (settings.clientId && secrets.clientSecret))) return 'Enter the client ID and secret (or an Admin API access token)';

  db.prepare(
    `INSERT INTO integrations (id, kind, store_id, status, error, settings_json, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'connected', NULL, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = 'connected', error = NULL, settings_json = excluded.settings_json,
       encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at,
       -- Another shop or ad account (non-secret settings changed) backfills from scratch; a new token picks up where it was.
       cursor = CASE WHEN settings_json = excluded.settings_json THEN cursor END`,
  ).run(id, kind, storeId ?? null, JSON.stringify(settings), encrypt(key, secrets, id), new Date().toISOString());
  return toIntegration(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id)!, key);
}

export const deleteIntegration = (db: Db, id: string) => db.prepare('DELETE FROM integrations WHERE id = ?').run(id).changes > 0;

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
  return { ok: true, uptimeSec: Math.round(process.uptime()), connectors };
}
