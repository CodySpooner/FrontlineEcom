import type { ReactNode } from 'react';
import { PR_ACCESS_LABEL, type PrSourceHealth } from '@frontline/shared';
import { Button, cx, Dialog, ErrorState, LoadingState } from '../components/ui';
import { useSourceHealth, useSyncSource } from './api';
import { Pill } from './Card';
import { sourceItem } from './format';

const DOT = { good: 'bg-good', warn: 'bg-[#f5b84a]', bad: 'bg-red', muted: 'bg-muted' };
const when = (iso: string | null, never = 'Never') => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : never);
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-dashed border-line py-[5px] last:border-b-0">
    <span className="shrink-0 text-muted">{label}</span>
    <span className="min-w-0 text-right text-text-2">{children}</span>
  </div>
);

/** PR-11: every source's status (decision 4), last success, errors, quota and calls, jobs, stale coverage, and Sync now. */
export function SourceHealth({ open, onClose, store }: { open: boolean; onClose: () => void; store: string | null }) {
  const health = useSourceHealth(store, open);
  return (
    <Dialog open={open} onClose={onClose} side="right" width={560} title="Source health" subtitle="Where products, demand and supplier data come from, and how each source is doing">
      <div className="grid gap-3 overflow-y-auto p-5">
        {health.isPending ? <LoadingState rows={5} /> : health.isError ? <ErrorState message={health.error.message} onRetry={() => void health.refetch()} /> : health.data.map((s) => <Source key={s.id} s={s} />)}
      </div>
    </Dialog>
  );
}

function Source({ s }: { s: PrSourceHealth }) {
  const sync = useSyncSource();
  const it = sourceItem(s);
  const capped = s.callsToday.map((c) => `${c.purpose.replace('_', ' ')} ${c.calls}${c.cap === null ? '' : ` of ${c.cap}`}`).join(' · ');
  return (
    <section aria-label={s.name} className="card p-4 text-xs">
      <header className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <i aria-hidden className={cx('size-[7px] shrink-0 rounded-full', DOT[it.tone])} />
            {s.name}
          </h3>
          <p className="mt-1 text-muted">{it.state}</p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <Pill tone={s.access === 'verified' ? 'good' : s.access === 'credentials_required' || s.access === 'approval_required' ? 'warn' : 'muted'}>{PR_ACCESS_LABEL[s.access]}</Pill>
          {s.canSync && (
            <Button size="sm" disabled={s.syncing || sync.isPending} onClick={() => sync.mutate(s.id)}>
              {s.syncing ? 'Syncing…' : 'Sync now'}
            </Button>
          )}
        </span>
      </header>
      {sync.error && (
        <p role="alert" className="mb-2 text-red">
          {sync.error.message}
        </p>
      )}
      {s.stopped && (
        <p role="status" className="mb-2 rounded-md border border-red/30 bg-red/8 px-2.5 py-1.5 text-text-2">
          <b className="text-text">Stopped.</b> {s.stopped}
        </p>
      )}
      <Row label="Answers">{s.answers.join(', ')}</Row>
      <Row label="Last successful sync">{when(s.lastSuccessAt)}</Row>
      {s.lastAttemptAt && <Row label="Last attempt">{when(s.lastAttemptAt)}</Row>}
      {s.lastError && <Row label={`Last error${s.errorKind ? ` (${s.errorKind.replace('_', ' ')})` : ''}`}>{s.lastError}</Row>}
      <Row label="Refresh">{s.refreshHours === null ? 'Not scheduled' : `Every ${s.refreshHours} h`}</Row>
      <Row label="Rate">{s.rate}</Row>
      <Row label="Quota">{s.points ? `${s.points.remaining.toLocaleString('en-US')} of ${s.points.total.toLocaleString('en-US')} points left today` : s.quota}</Row>
      {capped && <Row label="Calls today">{capped}</Row>}
      <Row label="Products">
        {`${s.products} with real data`}
        {s.fixtures > 0 && ` · ${s.fixtures} test fixtures`}
      </Row>
      {s.stale > 0 && <Row label="Stale coverage">{`${s.stale} product${s.stale === 1 ? '' : 's'}: newest offer check over 7 days old`}</Row>}
      {s.access !== 'verified' && <p className="mt-2 text-text-2"><b className="text-text">To connect:</b> {s.connect}</p>}
      {s.jobs.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">{`Recent jobs (${s.jobs.length})`}</summary>
          <ul className="mt-1 grid gap-1">
            {s.jobs.map((j) => (
              <li key={j.id} className="text-text-2">
                {`${j.kind} · ${j.status}${j.attempts ? ` · attempt ${j.attempts}` : ''} · ${when(j.finishedAt ?? j.createdAt)}`}
                {j.nextAttemptAt && j.status === 'queued' && ` · next try ${when(j.nextAttemptAt)}`}
                {j.error && <span className="block text-muted">{j.error}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {s.ledger.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">{`Call ledger (last ${s.ledger.length})`}</summary>
          <ul className="mt-1 grid gap-0.5">
            {s.ledger.map((c, i) => (
              <li key={i} className="text-text-2">{`${when(c.at)} · ${c.purpose.replace('_', ' ')} · ${c.ok ? 'ok' : 'failed'}`}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
