// SA-62: Store Analytics, one store at a time (decision 2): the title strip, the context bar and the tabs. A tab is
// listed only once its content ships (decision 33). The legacy Unit costs panel sits under the Overview until SA-92.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { settingsUrl, type SaDataset } from '@frontline/shared';
import { useSaContext } from '../analytics/api';
import { ContextBar } from '../analytics/ContextBar';
import { ListingsTab } from '../analytics/ListingsTab';
import { UnitCosts } from '../analytics/legacy';
import { Overview } from '../analytics/Overview';
import { useAnalyticsState, type AnalyticsPage } from '../analytics/state';
import { Hero } from '../components/Hero';
import { buttonClass, EmptyState, ErrorState, LoadingState, Tabs } from '../components/ui';
import { NAV } from '../nav';

/** The registered tabs, in the board's order, with the datasets their freshness chip reads. */
export const TABS: { value: string; label: string; datasets: SaDataset[]; render: (s: AnalyticsPage & { store: string }) => ReactNode }[] = [
  {
    value: 'overview',
    label: 'Overview',
    datasets: ['orders', 'refunds', 'catalog', 'inventory', 'traffic', 'ad_spend'],
    render: (s) => (
      <>
        <Overview s={s} tabs={TABS.map((t) => t.value)} />
        <UnitCosts ids={[s.store]} multi={false} />
      </>
    ),
  },
  { value: 'listings', label: 'Listings & Products', datasets: ['catalog', 'inventory', 'orders', 'refunds'], render: (s) => <ListingsTab key={s.store} s={s} /> }, // a store's own selection and expanded rows
];

export function Analytics() {
  const nav = NAV[2]!;
  const s = useAnalyticsState();
  const ctx = useSaContext(s.store);
  const tab = TABS.find((t) => t.value === s.tab) ?? TABS[0]!;
  let body: ReactNode;
  if (s.stores.isPending) body = <LoadingState rows={6} />;
  else if (s.stores.isError) body = <ErrorState message="Couldn't load your stores." onRetry={() => s.stores.refetch()} />;
  else if (s.noStores || !s.store)
    body = (
      <EmptyState title="No stores yet" action={<Link to={settingsUrl('stores')} className={buttonClass('primary')}>Add a store</Link>}>
        Store Analytics reads one store at a time.
      </EmptyState>
    );
  else
    body = (
      <>
        <ContextBar s={s} ctx={ctx.data} datasets={tab.datasets} />
        <Tabs variant="underline" label="Store Analytics sections" tabs={TABS} value={tab.value} onChange={(v) => s.set({ tab: v })} className="mb-3.5" />
        <div role="tabpanel" aria-label={tab.label}>
          {tab.render({ ...s, store: s.store })}
        </div>
      </>
    );
  // Under 640px the strip has no room beside its controls: the pill goes first in the page.
  const demo = (where: string) => ctx.data?.demo && <span className={`${where} shrink-0 rounded-full border border-amber/55 px-2 py-0.5 text-[10px] font-semibold tracking-[.08em] whitespace-nowrap text-amber uppercase`}>Demo data</span>;
  return (
    <>
      <Hero compact title={nav.title} icon={nav.icon}>
        {demo('hidden min-[640px]:inline')}
      </Hero>
      <div className="pt-3.5">
        {demo('mb-2.5 inline-block min-[640px]:hidden')}
        {body}
      </div>
    </>
  );
}
