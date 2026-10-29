import { SA_DATASETS, SA_SOURCES, settingsUrl, type SaDataset, type SaDatasetStatus, type SaFreshness, type SaReason, type SaSourceDataset, type SaSourceKind, type SaSourceRow } from '@frontline/shared';
import type { Db } from '../db';
import { decrypt } from '../secrets';

/** Long runs of key characters (API tokens, JWT segments, signed ids), with a "Bearer " before them. */
const TOKENISH = /(?:bearer\s+)?[A-Za-z0-9_-]{24,}(?:\.[A-Za-z0-9_-]+)*/gi;

/**
 * The one way a source error leaves the server (decision 23): every credential value (plain or URL-encoded) and every
 * token-shaped string removed, cut to 300 characters.
 */
export function scrubError(text: string, secrets: string[] = []) {
  let out = text;
  for (const s of secrets.filter((v) => v.length >= 4).sort((a, b) => b.length - a.length))
    out = out.replaceAll(s, '[hidden]').replaceAll(encodeURIComponent(s), '[hidden]');
  return out.replace(TOKENISH, '[hidden]').slice(0, 300);
}

/** An integration's secret values, to scrub its errors with. Kept in memory only. */
export function secretsOf(db: Db, key: Buffer, integrationId: string): string[] {
  const r = db.prepare('SELECT encrypted_credentials FROM integrations WHERE id = ?').get(integrationId);
  try {
    return Object.values(decrypt<Record<string, unknown>>(key, String(r?.encrypted_credentials), integrationId)).map(String);
  } catch {
    return [];
  }
}

const RUN_DAYS = 90;
const BACKOFF = [
  { failures: 6, ms: 6 * 3_600_000 },
  { failures: 3, ms: 30 * 60_000 },
];

/**
 * Decision 26: after 3 failed runs in a row an integration waits 30 minutes from the last one's end, after 6 it waits 6
 * hours; one success resets the count (an interrupted run counts as neither). Undefined: no wait. `since` is when the
 * last failure ended, so a credentials change or "Sync now" after it can still run at once.
 */
export function backoffOf(db: Db, integrationId: string) {
  const runs = db
    .prepare("SELECT status, coalesce(finished_at, started_at) AS at FROM sync_runs WHERE integration_id = ? AND status IN ('done', 'failed') ORDER BY id DESC LIMIT 6")
    .all(integrationId);
  const failures = runs.findIndex((r) => r.status !== 'failed');
  const n = failures === -1 ? runs.length : failures;
  const step = BACKOFF.find((b) => n >= b.failures);
  return step && { failures: n, since: String(runs[0]!.at), until: new Date(Date.parse(String(runs[0]!.at)) + step.ms).toISOString() };
}

/** At server start: runs the last process left `running` were cut off, and runs older than 90 days go. */
export function recoverRuns(db: Db, now = new Date()) {
  db.prepare("UPDATE sync_runs SET status = 'interrupted' WHERE status = 'running'").run();
  db.prepare('DELETE FROM sync_runs WHERE started_at < ?').run(new Date(now.getTime() - RUN_DAYS * 86_400_000).toISOString());
}

export function startRun(db: Db, integrationId: string, storeId: string | null, kind: string, now = new Date()) {
  return Number(
    db.prepare("INSERT INTO sync_runs (integration_id, store_id, kind, started_at, status) VALUES (?, ?, ?, ?, 'running')").run(integrationId, storeId, kind, now.toISOString()).lastInsertRowid,
  );
}

/** `error` undefined: the run succeeded. Returns the scrubbed error. */
export function endRun(db: Db, key: Buffer, runId: number, integrationId: string, error?: string, now = new Date()) {
  const scrubbed = error === undefined ? null : scrubError(error, secretsOf(db, key, integrationId));
  db.prepare('UPDATE sync_runs SET finished_at = ?, status = ?, error = ? WHERE id = ?').run(now.toISOString(), scrubbed === null ? 'done' : 'failed', scrubbed, runId);
  return scrubbed;
}

/** startSyncLoop's intervals (its fastMs for Shopify and WooCommerce, staleMs otherwise); Amazon asks for its traffic report once a day. */
const intervalMs = (kind: SaSourceKind, dataset: SaDataset) =>
  kind === 'amazon' && dataset === 'traffic' ? 86_400_000 : kind === 'shopify' || kind === 'woocommerce' ? 2 * 60_000 : 10 * 60_000;

type Integration = { id: string; kind: SaSourceKind; status: string; error: string | null; settings: string };

/** The settings that say which account an integration reads: a verified mark holds only while they stay the same. */
const ACCOUNT_KEYS: Partial<Record<SaSourceKind, string[]>> = {
  shopify: ['shopDomain'],
  woocommerce: ['siteUrl'],
  etsy: ['shopId'],
  amazon: ['sellerId', 'marketplaceId'],
  // ponytail: an app key can authorize several shops; `shop` names one only when the owner set it.
  tiktok_shop: ['shop', 'appKey'],
  meta_ads: ['adAccountId'],
  google_ads: ['customerId'],
  tiktok_ads: ['advertiserId'],
  ga4: ['propertyId'],
};

/** "glow-haus.myshopify.com", "a1seller / atvpdkikx0der": the account an integration's settings name, if any. */
export function accountOf(kind: SaSourceKind, settingsJson: string) {
  const s = JSON.parse(settingsJson || '{}') as Record<string, unknown>;
  const parts = (ACCOUNT_KEYS[kind] ?? []).map((k) => String(s[k] ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')).filter(Boolean);
  return parts.length ? parts.join(' / ') : undefined;
}

/** The sources a store's numbers come from: its demo generator, or its own platform and every integration it has. */
function storeSources(db: Db, storeId: string): { kind: SaSourceKind; integration?: Integration }[] {
  const store = db.prepare('SELECT platform, demo FROM stores WHERE id = ?').get(storeId);
  if (!store) return [];
  if (store.demo) return [{ kind: 'demo' }];
  const integrations = db
    .prepare('SELECT id, kind, status, error, settings_json FROM integrations WHERE store_id = ? ORDER BY id')
    .all(storeId)
    .filter((r) => String(r.kind) in SA_SOURCES)
    .map((r) => ({ id: String(r.id), kind: r.kind as SaSourceKind, status: String(r.status), error: r.error == null ? null : String(r.error), settings: String(r.settings_json ?? '{}') }));
  const platform = String(store.platform) as SaSourceKind;
  return [...(platform in SA_SOURCES && !integrations.some((i) => i.kind === platform) ? [{ kind: platform }] : []), ...integrations.map((i) => ({ kind: i.kind, integration: i }))];
}

/**
 * Per source and dataset of the store: its status, last success and try, `stale`, the scrubbed error and the days it
 * covers (decision 23). Never empty for a store: an unconnected platform's datasets read `needs_credentials`.
 */
export function datasetFreshness(db: Db, storeId: string, now = Date.now()): SaFreshness[] {
  const read = db.prepare(
    'SELECT status, last_try_at, last_success_at, error, covered_from, covered_to, verified_at, verified_account, verified_note FROM source_datasets WHERE integration_id = ? AND dataset = ?',
  );
  return storeSources(db, storeId).flatMap(({ kind, integration }) =>
    (Object.entries(SA_SOURCES[kind].datasets) as [SaDataset, SaSourceDataset][]).map(([dataset, d]) => {
      const row = integration && d.support === 'supported' && d.reads ? read.get(integration.id, dataset) : undefined;
      // Decision 24: Live verified only while the latest read worked and the integration is on the account it was checked on.
      const verified = row?.status === 'available' && row.verified_at != null && row.verified_account === accountOf(kind, integration!.settings)
        ? { at: String(row.verified_at), account: String(row.verified_account), note: String(row.verified_note ?? '') }
        : undefined;
      const [status, reason]: [SaDatasetStatus, SaReason?] =
        verified ? ['verified'] :
        kind === 'demo' ? [d.support === 'unsupported' ? 'unsupported' : 'demo']
        : d.support !== 'supported' ? [d.support]
        : !integration ? ['needs_credentials', 'needs_credentials']
        : !d.reads ? ['not_tracked', 'not_tracked']
        : row ? [row.status as SaDatasetStatus]
        : integration.status === 'error' ? ['failed', 'failed']
        : ['not_tracked', 'needs_ingestion'];
      const lastSuccess = row?.last_success_at == null ? null : String(row.last_success_at);
      // ponytail: an integration's own error is scrubbed of token-shaped strings only (connectors keep credentials out of it).
      const error = row?.error != null ? String(row.error) : !row && status === 'failed' && integration?.error ? scrubError(integration.error) : null;
      return {
        source: kind,
        dataset,
        status,
        ...(reason ? { reason } : {}),
        lastSuccess,
        lastTry: row?.last_try_at == null ? null : String(row.last_try_at),
        stale: !!lastSuccess && now - Date.parse(lastSuccess) > 3 * intervalMs(kind, dataset),
        error,
        coveredFrom: row?.covered_from == null ? null : String(row.covered_from),
        coveredTo: row?.covered_to == null ? null : String(row.covered_to),
        ...(verified ? { verified } : {}),
      };
    }),
  );
}

/**
 * Records the owner's live comparison of one dataset (PUT /api/analytics/sources/verified), tied to the account the
 * integration reads now. Only the store's own integration (404 otherwise), a dataset it reads and has synced, and a note.
 */
export function markVerified(db: Db, storeId: string, integration: unknown, dataset: unknown, note: unknown, now = new Date()): { refused: string; status: 400 | 404 } | SaFreshness {
  const i = typeof integration === 'string' ? db.prepare('SELECT kind, settings_json FROM integrations WHERE id = ? AND store_id = ?').get(integration, storeId) : undefined;
  if (!i || !(String(i.kind) in SA_SOURCES)) return { refused: 'integration not found', status: 404 };
  const kind = i.kind as SaSourceKind;
  const d = typeof dataset === 'string' ? SA_SOURCES[kind].datasets[dataset as SaDataset] : undefined;
  if (!d || d.support !== 'supported' || !d.reads) return { refused: `${SA_SOURCES[kind].name} has no dataset ${String(dataset)} the app reads`, status: 400 };
  if (typeof note !== 'string' || !note.trim() || note.length > 500) return { refused: 'note: what was compared, 1 to 500 characters', status: 400 };
  const account = accountOf(kind, String(i.settings_json ?? '{}'));
  if (!account) return { refused: `${SA_SOURCES[kind].name}'s settings name no account to tie the mark to`, status: 400 };
  const ok = db
    .prepare("UPDATE source_datasets SET verified_at = ?, verified_account = ?, verified_note = ? WHERE integration_id = ? AND dataset = ? AND last_success_at IS NOT NULL")
    .run(now.toISOString(), account, note.trim(), String(integration), String(dataset)).changes;
  if (!ok) return { refused: 'Not synced yet: verify a dataset after a successful read', status: 400 };
  return datasetFreshness(db, storeId, now.getTime()).find((f) => f.source === kind && f.dataset === dataset)!;
}

/** The Data sources panel: every row of datasetFreshness with what it reads, its backoff wait and a fix link. */
export function sourceRows(db: Db, storeId: string, now = Date.now()): SaSourceRow[] {
  const waits = new Map<string, string | null>();
  const wait = (kind: SaSourceKind) => {
    const id = `${kind}:${storeId}`;
    if (!waits.has(id)) {
      const until = backoffOf(db, id)?.until;
      waits.set(id, until && Date.parse(until) > now ? until : null);
    }
    return waits.get(id)!;
  };
  return datasetFreshness(db, storeId, now).map((f) => {
    const s = SA_SOURCES[f.source];
    const d = s.datasets[f.dataset]!;
    const fixable = f.status === 'needs_credentials' || f.status === 'needs_permission' || f.status === 'failed' || f.stale;
    return {
      ...f,
      name: s.name,
      label: SA_DATASETS[f.dataset],
      field: d.field,
      ...(d.reason ? { note: d.reason } : {}),
      backoffUntil: f.source === 'demo' ? null : wait(f.source),
      ...(fixable ? { fix: { label: f.status === 'needs_credentials' ? `Connect ${s.name}` : `Check ${s.name}`, href: settingsUrl('integrations', { store: storeId }) } } : {}),
    };
  });
}
