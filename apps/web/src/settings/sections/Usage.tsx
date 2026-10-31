// Usage & Limits (ST-24a/b, decision 10): today's meters per store, the same counters that stop a run, a render or a
// raise; the ad and credit caps for the workspace or one store (one explicit save through PATCH /api/config); how the
// AI limits stack; the limits Frontline sets; and what has been spent so far. Autopilot is on Automation & Approvals (ST-30).
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTINGS, settingsUrl, type ConfigImpact, type ConfigView, type FrontlineLimit, type StoreCaps } from '@frontline/shared';
import { agentsUrl } from '../../agents/urls';
import { api, json, useConfig, useUsage, type ApiError } from '../../api/client';
import { cx, ErrorState, inputClass, LoadingState, UsageMeter } from '../../components/ui';
import { useOfficeStats } from '../../ecosystem/api';
import { cents, money } from '../../lib/format';
import { creditsUsed, pendingRenders } from '../../lib/usage';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope, type Origin } from '../kit';
import { same } from '../useDraft';

export function Usage() {
  return (
    <>
      <Today />
      <DailyCaps />
      <Stacking />
      <SetByFrontline />
      <SoFar />
    </>
  );
}

const link = 'text-[13px] text-[#ff6b76] hover:underline';
const count = (n: number) => n.toLocaleString('en-US');

/** One block per store (the store in scope only): AI usage, ad budget raises and credits, each against its cap. */
function Today() {
  const scope = useScope();
  const stores = !scope.ready ? undefined : scope.store ? [scope.store] : scope.stores;
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
                <UsageMeter label={`${s.name} Higgsfield credits`} used={creditsUsed(u)} cap={c.higgsfieldCreditsPerDay} fmt={count} note={pendingRenders(u)} />
              </div>
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}

// The ad and credit caps: workspace defaults with store overrides (decision 10). AI usage per day is on Agents & Providers.
const AD = 'caps.adSpendChangePerDay';
const CREDITS = 'caps.higgsfieldCreditsPerDay';
const IDS = [AD, CREDITS] as const;
type Id = (typeof IDS)[number];
type Form = { version: number } & Partial<Record<Id, number>>;
const def = (id: Id) => SETTINGS.find((s) => s.id === id)!;
const shown = (id: Id, n: unknown) => (id === AD ? money(Number(n)) : `${count(Number(n))} credits`);

/** The caps set at this scope (the store's own, or the workspace's); an inherited one is absent. */
const toForm = (v: ConfigView, store?: string): Form => ({
  version: (store ? v.versions[`store_caps:${store}`] : v.versions.workspace) ?? 0,
  ...Object.fromEntries(IDS.filter((id) => v.origins[id] === (store ? 'store' : 'workspace')).map((id) => [id, v.values[id]])),
});
/** The changed caps as one document: a value set, or unset (back to the workspace's, or the built-in one). */
function documentsOf(changes: Partial<Form>, base: Form, store?: string) {
  const ids = IDS.filter((id) => id in changes);
  const set = Object.fromEntries(ids.filter((id) => changes[id] !== undefined).map((id) => [id, changes[id]]));
  const unset = ids.filter((id) => changes[id] === undefined);
  return ids.length ? [{ doc: store ? 'store_caps' : 'workspace', ...(store ? { storeId: store } : {}), version: base.version, ...(unset.length < ids.length ? { set } : {}), ...(unset.length ? { unset } : {}) }] : [];
}

function DailyCaps() {
  const scope = useScope();
  const store = scope.store;
  const sid = store?.id;
  const qc = useQueryClient();
  const ws = useConfig();
  const q = useConfig(sid);
  const f = useSettingsForm<Form>({
    key: `usage:${sid ?? 'workspace'}`,
    saved: q.data && toForm(q.data, sid),
    labels: { [AD]: def(AD).label, [CREDITS]: def(CREDITS).label },
    save: (changes, _version, base) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: documentsOf(changes, base, sid) })).then(
        (v) => (qc.setQueryData(['config', 'view', sid ?? null], v), { ...toForm(v, sid), changes: v.changes }),
        (e: ApiError) => {
          if (e.current) e.current = toForm(e.current as ConfigView, sid);
          throw e;
        },
      ),
    onSaved: () => void (qc.invalidateQueries({ queryKey: ['config'] }), qc.invalidateQueries({ queryKey: ['caps'] })),
  });
  const documents = q.data && f.dirty.length ? documentsOf(f.changes(), toForm(q.data, sid), sid) : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  const title = store ? `${store.name} daily caps` : 'Workspace daily caps';
  if (!scope.ready || q.isPending || ws.isPending) return <SettingsSection title={title}><LoadingState rows={2} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError || ws.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load your settings." onRetry={() => (q.refetch(), ws.refetch())} /></SettingsSection>;
  const d = f.draft!;
  /** In a store's scope: inherited, or the store's own with the workspace's value and Use workspace default. */
  const origin = (id: Id): Origin | undefined =>
    !sid ? undefined : d[id] === undefined ? { kind: 'workspace' } : { kind: 'store', workspace: shown(id, ws.data.values[id]), same: same(d[id], ws.data.values[id]), onUse: () => f.set(id, undefined) };
  // The sentence doesn't name its cap, and both caps can earn one: each says which.
  const texts = documents.length ? (impact.data?.impacts.map((i) => `${def(i.setting as Id).label}: ${i.text}`) ?? []) : [];
  return (
    <>
      <SettingsSection title={title} help={store ? `Leave one empty to follow the workspace default.` : 'For every store that uses the workspace default.'}>
        {IDS.map((id) => (
          <SettingRow key={id} setting={id} error={f.error(id)} changed={f.dirty.includes(id)} label={def(id).label} htmlFor={`${id}-input`} help={def(id).help} origin={origin(id)}>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              {id === AD && '$'}
              <input
                id={`${id}-input`}
                data-setting={id}
                type="number"
                min={0}
                max={1_000_000}
                step="any"
                value={d[id] ?? ''}
                placeholder={String(sid ? ws.data.values[id] : def(id).default)}
                onChange={(e) => f.set(id, e.target.value === '' ? undefined : e.target.valueAsNumber)}
                className={cx(inputClass, 'w-[110px] py-1.5')}
              />
              {id === CREDITS && 'credits'}
            </span>
          </SettingRow>
        ))}
        <p className="border-t border-line px-[18px] py-3 text-xs text-muted">
          AI usage per day is set on{' '}
          <Link to={settingsUrl('agents', { store: sid, setting: 'caps.agentCostPerDay' })} className={link}>
            Agents & Providers
          </Link>
          .
        </p>
      </SettingsSection>
      <SaveBar {...f.bar} scope={store?.name ?? 'Workspace defaults'} impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined} />
      {f.dialogs}
    </>
  );
}

/** "How AI limits stack": every budget a run can meet, with its clock and where it is edited (runs.ts pump). */
function Stacking() {
  const sid = useScope().store?.id;
  const agents = sid ? agentsUrl({ store: sid }) : '/agents';
  const rows = [
    { limit: 'Store AI usage per day', clock: "Since midnight in the workspace's time zone. One run gets at most the cap ÷ runs at once per store.", where: 'Agents & Providers', to: settingsUrl('agents', { store: sid, setting: 'caps.agentCostPerDay' }) },
    { limit: "An agent's daily budget", clock: "Since midnight in the workspace's time zone, shared by that agent's runs going at once.", where: 'AI Agents, the agent', to: agents },
    { limit: "A team's budget", clock: "The team's whole life. Only its Claude steps are charged.", where: 'AI Agents, Create team', to: agents },
    { limit: 'A run budget', clock: 'One run.', where: "AI Agents, an agent's setup", to: agents },
    { limit: 'Knowledge research', clock: 'Per task; self-directed research also per rolling 24 hours.', where: 'Knowledge, Research Center', to: '/knowledge?view=research' },
  ];
  return (
    <SettingsSection title="How AI limits stack" help="A run stops at the smallest budget that applies to it. Each is a local estimate at list prices, not a cap at the provider, and a stop never refunds what was already spent.">
      {rows.map((r) => (
        <SettingRow key={r.limit} label={r.limit} help={r.clock}>
          <Link to={r.to} className={link}>
            {r.where}
          </Link>
        </SettingRow>
      ))}
    </SettingsSection>
  );
}

/** Built-in limits, read-only: each value comes from the constant that enforces it (GET /api/config/limits). */
function SetByFrontline() {
  const q = useQuery({ queryKey: ['config', 'limits'], queryFn: () => api<FrontlineLimit[]>('/api/config/limits') });
  const title = 'Limits Frontline sets';
  const help = 'Built in, so they are not editable. Each is the value the app enforces.';
  if (q.isPending) return <SettingsSection title={title} help={help}><LoadingState rows={3} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError) return <SettingsSection title={title} help={help}><ErrorState message="Couldn't load the limits." onRetry={() => q.refetch()} /></SettingsSection>;
  return (
    <SettingsSection title={title} help={help}>
      {q.data.map((l) => (
        <SettingRow key={l.label} label={l.label}>
          <span className="text-[13px] text-text-2">{l.value}</span>
        </SettingRow>
      ))}
    </SettingsSection>
  );
}

/** All-time AI usage from the runs' records (GET /api/ecosystem/stats), and what Frontline can't know. */
function SoFar() {
  const s = useOfficeStats().data;
  const title = 'Cost so far';
  return (
    <SettingsSection title={title} help="Every run since Frontline was installed.">
      {typeof s?.costUsd !== 'number' ? (
        <LoadingState rows={2} className="px-[18px] pb-4" />
      ) : (
        <>
          <SettingRow label="AI usage, all time" help="An estimate at list prices from what each run reported. Codex and demo runs add nothing.">
            <span className="text-[13px] text-text-2 tabular-nums">{cents(s.costUsd)}</span>
          </SettingRow>
          <SettingRow label="Tokens, all time" help="As each runtime reported them.">
            <span className="text-[13px] text-text-2 tabular-nums">
              {count(s.inputTokens)} in · {count(s.outputTokens)} out
            </span>
          </SettingRow>
        </>
      )}
      <SettingRow label="Provider-reported charges">
        <span className="text-[13px] text-muted">Not available: Frontline can't read your Claude or Codex bill.</span>
      </SettingRow>
    </SettingsSection>
  );
}
