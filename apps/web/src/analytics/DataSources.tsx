// SA-64: the Data sources panel (spec §5 Honest coverage states): each source × dataset the store's numbers read, in
// the words every surface uses, with what to do about the ones that aren't there.
import { Link } from 'react-router';
import { SA_DATASET_STATUSES, type SaSourceRow } from '@frontline/shared';
import { Badge, Dialog, ErrorState, LoadingState } from '../components/ui';
import { ago, fmtDay } from '../lib/format';
import { useSaReconcile, useSaSources } from './api';
import type { AnalyticsState } from './state';

const TONE: Partial<Record<SaSourceRow['status'], 'good' | 'red' | 'muted'>> = { verified: 'good', available: 'good', failed: 'red', needs_permission: 'red' };
const at = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Row({ r }: { r: SaSourceRow }) {
  const facts = [
    r.lastSuccess ? `Last success ${ago(r.lastSuccess)}` : r.status !== 'demo' && r.status !== 'unsupported' && 'No successful sync yet',
    r.stale && 'stale',
    r.coveredFrom && r.coveredTo && `covers ${fmtDay(r.coveredFrom, true)} – ${fmtDay(r.coveredTo, true)}`,
  ].filter(Boolean);
  return (
    <li className="grid gap-1 border-b border-line py-2.5 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{r.label}</span>
        <Badge tone={TONE[r.status] ?? 'muted'}>{SA_DATASET_STATUSES[r.status]}</Badge>
      </div>
      {facts.length > 0 && <p className={r.stale ? 'text-xs text-red' : 'text-xs text-muted'}>{facts.join(' · ')}</p>}
      {r.verified && <p className="text-xs text-good">Live verified {fmtDay(r.verified.at.slice(0, 10), true)}: {r.verified.note}</p>}
      {r.rereading !== undefined && <p className="text-xs text-text-2">Re-reading history: {Math.floor(r.rereading * 100)}% done</p>}
      {r.error && <p className="text-xs break-words text-red">{r.error}</p>}
      {r.backoffUntil && <p className="text-xs text-muted">Failing repeatedly: next try {at(r.backoffUntil)}</p>}
      {r.note && <p className="text-xs text-muted">{r.note}</p>}
      {r.source !== 'demo' && r.field !== '—' && <p className="text-[11px] text-muted/80">Reads {r.field}</p>}
      {r.fix && (
        <Link to={r.fix.href} className="text-xs font-semibold text-red hover:underline">
          {r.fix.label}
        </Link>
      )}
    </li>
  );
}

export function DataSources({ s, open, onClose }: { s: AnalyticsState; open: boolean; onClose: () => void }) {
  const sources = useSaSources(open ? s.store : undefined);
  const dedupe = useSaReconcile({ ...s, store: open ? s.store : undefined }).data?.dedupe;
  const groups = new Map<string, SaSourceRow[]>();
  for (const r of sources.data ?? []) groups.set(r.name, [...(groups.get(r.name) ?? []), r]);
  return (
    <Dialog open={open} onClose={onClose} side="right" width={480} title="Data sources" subtitle="Syncs run only while Frontline Ecom is open.">
      {sources.isError ? (
        <ErrorState message="Couldn't load the data sources." onRetry={() => sources.refetch()} />
      ) : !sources.data ? (
        <LoadingState rows={5} />
      ) : (
        <>
          {[...groups].map(([name, rows]) => (
            <section key={name} className="mb-3">
              <h3 className="font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">{name}</h3>
              <ul>{rows.map((r) => <Row key={`${r.source}:${r.dataset}`} r={r} />)}</ul>
            </section>
          ))}
          {dedupe && dedupe.lines.length > 0 && (
            <section className="mb-3">
              <h3 className="font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">Orders counted once</h3>
              <ul className="mt-1.5 grid gap-1 text-xs text-text-2">{dedupe.lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </Dialog>
  );
}
