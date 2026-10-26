import { INTEGRATION_KINDS, type Integration, type IntegrationInput, type IntegrationKind, type IntegrationStatus } from '@frontline/shared';
import type { Db } from './db';
import { decrypt, encrypt } from './secrets';
import { getStore } from './stores';

type Row = Record<string, unknown>;

const idOf = (kind: string, storeId?: string | null) => `${kind}:${storeId ?? 'global'}`;

const toIntegration = (r: Row, key: Buffer): Integration => ({
  id: String(r.id),
  kind: r.kind as IntegrationKind,
  ...(r.store_id ? { storeId: String(r.store_id) } : {}),
  status: r.status as IntegrationStatus,
  ...(r.error ? { error: String(r.error) } : {}),
  settings: JSON.parse(String(r.settings_json)),
  secretsSet: Object.keys(decrypt<Record<string, string>>(key, String(r.encrypted_credentials), String(r.id))),
  updatedAt: String(r.updated_at),
});

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
  const existing = db.prepare('SELECT encrypted_credentials FROM integrations WHERE id = ?').get(id);
  const oldSecrets = existing ? decrypt<Record<string, string>>(key, String(existing.encrypted_credentials), id) : {};
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = values[f.key]?.trim() || (f.secret ? oldSecrets[f.key] : undefined);
    if (!v) return `${f.label} is required`;
    (f.secret ? secrets : settings)[f.key] = v;
  }

  db.prepare(
    `INSERT INTO integrations (id, kind, store_id, status, error, settings_json, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'connected', NULL, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET status = 'connected', error = NULL, settings_json = excluded.settings_json,
       encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at`,
  ).run(id, kind, storeId ?? null, JSON.stringify(settings), encrypt(key, secrets, id), new Date().toISOString());
  return toIntegration(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id)!, key);
}

export const deleteIntegration = (db: Db, id: string) => db.prepare('DELETE FROM integrations WHERE id = ?').run(id).changes > 0;

/** For connectors only: settings + decrypted secrets. Never send this to the client or a log. */
export function getCredentials(db: Db, key: Buffer, kind: IntegrationKind, storeId?: string): Record<string, string> | undefined {
  const id = idOf(kind, storeId);
  const r = db.prepare('SELECT settings_json, encrypted_credentials FROM integrations WHERE id = ?').get(id);
  return r && { ...JSON.parse(String(r.settings_json)), ...decrypt<Record<string, string>>(key, String(r.encrypted_credentials), id) };
}

