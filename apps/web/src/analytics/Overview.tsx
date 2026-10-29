// The v1 Overview as its pieces ship (SA-70 on), above the legacy view until SA-79 replaces it.
import { useSaContext, useSaOverview } from './api';
import { FilterScope } from './FilterScope';
import { KpiStrip } from './KpiStrip';
import type { AnalyticsState } from './state';
import { ErrorState, LoadingState } from '../components/ui';

export function Overview({ s, tabs }: { s: AnalyticsState; tabs: string[] }) {
  const o = useSaOverview(s);
  const ctx = useSaContext(s.store);
  if (o.isError) return <ErrorState message="Couldn't load the Overview." onRetry={() => o.refetch()} />;
  if (!o.data) return <LoadingState rows={2} />;
  return (
    <section aria-label="Key numbers" className="mb-4 grid gap-2">
      <KpiStrip metrics={o.data.metrics} ctx={ctx.data} tabs={tabs} />
      <FilterScope scope={o.data.scope} />
    </section>
  );
}
