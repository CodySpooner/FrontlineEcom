// Change History (ST-32, decision 15): every saved setting, newest first, 50 a page (ST-09's API). Who changed it and
// where, the setting's registry label, before → after (a secret only says Replaced or Removed), and whether it applied,
// with Retry on a failed apply. Filters: scope, store (a deleted one too, by its last name), and a search over settings.
import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INTEGRATION_KINDS, SETTINGS, type ChangeHistoryStore, type ConfigChange, type ConfigChangesPage, type IntegrationKind } from '@frontline/shared';
import { api } from '../../api/client';
import { Badge, cx, ErrorState, flatButtonClass, inputClass, LoadingState } from '../../components/ui';
import { SettingsSection } from '../kit';

const LABEL = new Map(SETTINGS.map((d) => [d.id, d.label]));
const ACTOR: Record<string, string> = { owner: 'You', import: 'Import', migration: 'Migration', system: 'System' };
const who = (actor: string) => {
  const sync = /^sync:(.+)$/.exec(actor)?.[1];
  return sync ? `${INTEGRATION_KINDS[sync as IntegrationKind]?.name ?? sync} sync` : (ACTOR[actor] ?? actor);
};
const where = (c: ConfigChange) => (c.scope === 'store' ? (c.storeName ?? c.storeId ?? 'A store') : c.scope === 'personal' ? 'Personal' : 'Workspace');
/** A value by its type: on/off, a number, a list, a map's pairs; nothing yet is "Not set". */
function fmt(v: unknown): string {
  if (v == null) return 'Not set';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (Array.isArray(v)) return v.length ? v.map(fmt).join(', ') : 'None';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${fmt(x)}`).join(', ') || 'None';
  return String(v);
}
/** A secret's row holds no value, only that it was replaced or removed. */
const secret = (c: ConfigChange) => !('before' in c) && !('after' in c) && (c.detail === 'replaced' || c.detail === 'removed');
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const STATE = { saved: 'Saved', applying: 'Applying…', applied: 'Applied', failed: 'Failed' } as const;

export function History() {
  const [scope, setScope] = useState('');
  const [store, setStore] = useState('');
  const [search, setSearch] = useState('');
  const stores = useQuery({ queryKey: ['config', 'changes', 'stores'], queryFn: () => api<ChangeHistoryStore[]>('/api/config/changes/stores') });
  const q = useInfiniteQuery({
    queryKey: ['config', 'changes', { scope, store, search: search.trim() }],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(Object.entries({ scope, store, search: search.trim(), cursor: pageParam }).filter(([, v]) => v));
      return api<ConfigChangesPage>(`/api/config/changes${p.size ? `?${p}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData, // typing in search keeps the last rows up until the new ones land
  });
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (c: ConfigChange) => api<ConfigChange>(`/api/config/changes/${c.id}/retry${c.storeId ? `?store=${encodeURIComponent(c.storeId)}` : ''}`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['config', 'changes'] }),
  });
  const rows = q.data?.pages.flatMap((p) => p.changes);
  return (
    <SettingsSection
      title="Changes"
      help={
        <>
          Every setting saved here or by an import, a migration or a sync, newest first. Secrets show only that they changed. Changes to a live store or ad account are in{' '}
          <Link to="/automation" className="text-[#ff6b76] hover:underline">
            Automation → Executed Actions
          </Link>
          .
        </>
      }
    >
      <div data-action="history.filter" className="flex flex-wrap gap-2 px-[18px] pb-3">
        <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} className={cx(inputClass, 'py-1.5')}>
          <option value="">Every scope</option>
          <option value="workspace">Workspace</option>
          <option value="store">Store</option>
          <option value="personal">Personal</option>
        </select>
        <select aria-label="Store" value={store} onChange={(e) => setStore(e.target.value)} className={cx(inputClass, 'py-1.5')}>
          <option value="">Every store</option>
          {stores.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.deleted ? `${s.name} (deleted)` : s.name}
            </option>
          ))}
        </select>
        <input type="search" aria-label="Search settings" placeholder="Search settings" value={search} onChange={(e) => setSearch(e.target.value)} className={cx(inputClass, 'min-w-[200px] flex-1 py-1.5')} />
      </div>
      {q.isPending ? (
        <LoadingState rows={3} className="px-[18px] pb-4" />
      ) : q.isError ? (
        <ErrorState message="Couldn't load Change History." onRetry={() => q.refetch()} />
      ) : !rows?.length ? (
        <p className="border-t border-line px-[18px] py-3 text-[13px] text-muted">{scope || store || search.trim() ? 'No changes match.' : 'No changes yet.'}</p>
      ) : (
        <ul aria-label="Changes" className="border-t border-line text-[13px]">
          {rows.map((c) => (
            <li key={c.id} className="grid gap-1 border-b border-line px-[18px] py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">{LABEL.get(c.setting) ?? c.setting}</span>
                <span className="text-xs text-muted">{`${where(c)} · ${who(c.actor)} · ${when(c.at)}`}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Badge tone={c.state === 'failed' ? 'red' : c.state === 'applied' ? 'good' : 'muted'}>{STATE[c.state]}</Badge>
                  {c.state === 'failed' && (
                    <button type="button" data-action="history.retry" disabled={retry.isPending && retry.variables?.id === c.id} onClick={() => retry.mutate(c)} className={flatButtonClass('default', 'sm')}>
                      Retry
                    </button>
                  )}
                </span>
              </div>
              <p className="text-text-2 [overflow-wrap:anywhere]">{secret(c) ? (c.detail === 'removed' ? 'Removed' : 'Replaced') : `${fmt(c.before)} → ${fmt(c.after)}`}</p>
              {c.detail && !secret(c) && <p className={cx('text-xs', c.state === 'failed' ? 'text-red' : 'text-muted')}>{c.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      {retry.error && (
        <p role="alert" className="px-[18px] py-2 text-xs text-red">
          {retry.error.message}
        </p>
      )}
      {q.hasNextPage && (
        <div className="border-t border-line px-[18px] py-2.5">
          <button type="button" data-action="history.more" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()} className={flatButtonClass('ghost', 'sm')}>
            {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
