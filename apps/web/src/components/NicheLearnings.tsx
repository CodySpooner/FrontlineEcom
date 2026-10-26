import { Trash2 } from 'lucide-react';
import { useForgetNicheLearning, useNicheLearnings } from '../api/client';
import { ago } from '../lib/format';
import { useStoreSelection } from './StoreFilter';
import { ErrorState, LoadingState, Panel } from './ui';

/** Owner-approved learnings every store in a niche sees (promoted from one store's memory), by store or by niche key. */
export function SharedLearnings({ by, niche }: { by: { store: string } | { niche: string }; niche: string }) {
  const q = useNicheLearnings(by);
  const forget = useForgetNicheLearning();
  const { name } = useStoreSelection();
  return (
    <Panel title={`Shared with all ${niche} stores`} sub="Learnings you approved for the whole niche. Every squad in it sees them.">
      {q.isPending ? (
        <LoadingState rows={2} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load the niche learnings." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <p className="text-[13px] text-muted">None yet. When an agent finds something every {niche} store should know, it asks you to share it here.</p>
      ) : (
        <ul className="grid gap-2">
          {q.data.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-4 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px]">{l.text}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {l.storeId && `Learned in ${name(l.storeId)} · `}
                  {ago(l.createdAt, Date.now())}
                  {l.evidence && ` · ${l.evidence}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => forget.mutate(l.id)}
                disabled={forget.isPending}
                aria-label={`Stop sharing: ${l.text}`}
                className="cursor-pointer rounded-md p-1.5 text-muted transition hover:bg-panel-2 hover:text-red"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {forget.isError && (
        <p role="alert" className="mt-2 text-xs text-red">
          {forget.error.message}
        </p>
      )}
    </Panel>
  );
}
