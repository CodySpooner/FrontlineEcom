// Usage & Limits (ST-24a, decision 10): today's meters per store, the same counters that stop a run, a render or a
// raise. ST-24b rebuilds the editors below them; until then the moved caps form stays.
import { useQuery } from '@tanstack/react-query';
import type { StoreCaps } from '@frontline/shared';
import { api, useConfig, useStores, useUsage } from '../../api/client';
import { ErrorState, LoadingState, UsageMeter } from '../../components/ui';
import { cents, money } from '../../lib/format';
import { creditsUsed, pendingRenders } from '../../lib/usage';
import { SettingsSection } from '../kit';
import { Caps } from './legacy';

export function Usage() {
  return (
    <>
      <Today />
      <div data-legacy="ST-24b">
        <Caps />
      </div>
    </>
  );
}

/** One block per store: AI usage, ad budget raises and credits, each against its cap. */
function Today() {
  const stores = useStores().data;
  const caps = useQuery({ queryKey: ['caps', 'all'], queryFn: () => api<StoreCaps[]>('/api/caps') });
  const usage = useUsage(stores?.map((s) => s.id) ?? []);
  const zone = useConfig().data?.values.timezone;
  const title = 'Today';
  const help = `Since midnight in the workspace's time zone${typeof zone === 'string' ? ` (${zone})` : ''}.`;
  if (!stores || caps.isPending || usage.isPending) return <SettingsSection title={title} help={help}><LoadingState rows={3} className="px-[18px] pb-4" /></SettingsSection>;
  if (caps.isError || usage.isError) return <SettingsSection title={title} help={help}><ErrorState message="Couldn't load today's usage." onRetry={() => (caps.refetch(), usage.refetch())} /></SettingsSection>;
  return (
    <SettingsSection title={title} help={help}>
      {stores.map((s) => {
        const c = caps.data.find((x) => x.storeId === s.id);
        const u = usage.data.find((x) => x.storeId === s.id);
        if (!c || !u) return null;
        return (
          <div key={s.id} className="border-t border-line px-[18px] py-3">
            <h4 className="mb-2 text-[13px] font-medium">{s.name}</h4>
            <div className="grid gap-3 min-[700px]:grid-cols-3">
              <div className="grid gap-1">
                <span className="text-xs text-muted">AI usage</span>
                <UsageMeter label={`${s.name} AI usage`} used={u.agentCostUsd} cap={c.agentCostPerDay} fmt={cents} note="an estimate at list prices" />
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted">Ad budget raises</span>
                <UsageMeter label={`${s.name} ad budget raises`} used={u.adBudgetAddedUsd} cap={c.adSpendChangePerDay} fmt={money} note="approved or waiting on you" />
              </div>
              <div className="grid gap-1">
                <span className="text-xs text-muted">Higgsfield credits</span>
                <UsageMeter label={`${s.name} Higgsfield credits`} used={creditsUsed(u)} cap={c.higgsfieldCreditsPerDay} fmt={(n) => n.toLocaleString('en-US')} note={pendingRenders(u)} />
              </div>
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}
