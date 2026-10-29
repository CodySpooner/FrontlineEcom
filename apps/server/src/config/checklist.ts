// The setup checklist (ST-17, spec §7): what is genuinely unfinished, each item from real state, each with its deep link.
import { INTEGRATION_KINDS, settingsUrl, type Backup, type ClaudeAccount, type IntegrationKind, type SetupItem } from '@frontline/shared';
import { listBackups } from '../backups';
import type { Db } from '../db';

const FRESH_HOURS = 48;

/** `login` is the cached account check (`claudeLogin`); `backups` newest first, as `listBackups` gives them. */
export function checklist(db: Db, login: Pick<ClaudeAccount, 'signedIn' | 'error'>, now = new Date(), backups: Backup[] = listBackups()): SetupItem[] {
  // Demo stores are seeded, not the owner's: only a live store counts. A platform without a connector (Walmart) can't sync.
  const stores = db.prepare('SELECT id, name, platform FROM stores WHERE demo = 0 ORDER BY created_at, id').all();
  const integration = (kind: string, storeId: string | null) =>
    db.prepare('SELECT synced_at FROM integrations WHERE kind = ? AND store_id IS ?').get(kind, storeId) as { synced_at: string | null } | undefined;
  const cj = integration('cj', null);
  const age = backups[0] ? (now.getTime() - Date.parse(backups[0].createdAt)) / 3_600_000 : undefined;
  return [
    { id: 'store', title: 'Add your store', done: stores.length > 0, link: settingsUrl('stores'), detail: "Demo stores don't count." },
    // ST-21 moves this link to Settings → Agents.
    { id: 'claude', title: 'Sign in to Claude', done: login.signedIn, link: settingsUrl('integrations'), detail: login.error ?? 'Agents run on your Claude login.' },
    ...stores
      .filter((s) => INTEGRATION_KINDS[s.platform as IntegrationKind]?.category === 'platform')
      .map((s) => {
        const row = integration(String(s.platform), String(s.id));
        return {
          id: `platform:${String(s.id)}`,
          title: `Sync ${String(s.name)} from ${INTEGRATION_KINDS[s.platform as IntegrationKind].name}`,
          done: !!row?.synced_at,
          link: settingsUrl('integrations', { store: String(s.id) }),
          detail: row ? 'Connected, no successful sync yet.' : 'Not connected.',
        };
      }),
    // A saved key isn't enough: the CJ sync must have succeeded (`markSource`), not just answered the token call.
    {
      id: 'research',
      title: 'Verify a research source',
      done: !!db.prepare("SELECT 1 FROM pr_sources WHERE id = 'cj' AND last_success_at IS NOT NULL").get(),
      link: settingsUrl('integrations'),
      detail: cj ? 'CJ key saved, no successful sync yet.' : 'Connect CJ Dropshipping and let it sync once.',
    },
    {
      id: 'backup',
      title: 'Back up your data',
      done: age !== undefined && age < FRESH_HOURS,
      link: settingsUrl('data'),
      detail: age === undefined ? 'No backup yet.' : `The newest backup is ${Math.floor(age)} hours old.`,
    },
  ];
}
