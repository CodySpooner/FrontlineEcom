// Agents & Providers (ST-21, board A1, decision 9): the runtimes every store shares, and the defaults new runs start
// from (ST-20 wires them in), for the workspace or one store. One explicit save through PATCH /api/config.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CODEX_ULTRA, EFFORT_LABEL, type ConfigImpact, type ConfigView, type RuntimeCapabilities } from '@frontline/shared';
import { api, json, useClaudeAccount, useConfig, useRefreshRuntimes, useRuntimes, useSetUpCodex, type ApiError } from '../../api/client';
import { Badge, cx, ErrorState, flatButtonClass, inputClass, LoadingState, Segmented } from '../../components/ui';
import { useSettingsForm } from '../form';
import { SaveBar, SettingRow, SettingsSection, useScope, type Origin } from '../kit';
import { same } from '../useDraft';

export function Agents() {
  return (
    <>
      <Runtimes />
      <Defaults />
    </>
  );
}

const ENV: Origin = { kind: 'env', text: 'FRONTLINE_AGENT_ENGINE: every run uses the demo engine' };
const small = flatButtonClass('default', 'sm');

/** Claude, Codex and the demo engine, each with its status from a real check (no model turn). */
function Runtimes() {
  const { q: claude, recheck } = useClaudeAccount();
  const runtimes = useRuntimes();
  const refresh = useRefreshRuntimes();
  const setup = useSetUpCodex();
  const a = claude.data;
  const forced = !!a?.forced;
  const codex = runtimes.data?.find((r) => r.runtime === 'codex');
  const codexReady = codex?.connected && !codex.reason;
  return (
    <SettingsSection title="Runtimes" help="Shared by every store. Status comes from a real check of each login.">
      <SettingRow
        label="Claude"
        help={forced ? undefined : a && !a.signedIn ? (a.error ?? 'Run claude in a terminal and sign in with /login, then check again.') : 'Claude Code login on this computer · models listed by your account'}
        origin={forced ? ENV : undefined}
        error={recheck.error?.message}
      >
        {!forced && (
          <>
            <Badge tone={a?.signedIn ? 'good' : 'muted'}>{claude.isPending ? 'Checking…' : claude.isError ? "Couldn't check" : a!.signedIn ? (a!.email ? `Signed in as ${a!.email}` : 'Signed in') : 'Not signed in'}</Badge>
            <button type="button" data-action="agents.claude.check" disabled={recheck.isPending} onClick={() => recheck.mutate()} className={small}>
              {recheck.isPending ? 'Checking…' : 'Check again'}
            </button>
          </>
        )}
      </SettingRow>
      <SettingRow
        label="Codex"
        help={
          forced
            ? undefined
            : setup.isSuccess && !codexReady
              ? 'Sign in to Codex in the browser window that opened, then check again.'
              : codexReady
                ? `Codex CLI ${codex?.version ?? ''} signed in to the app's own Codex folder`
                : codex?.reason && codex.reason !== 'Set up Codex'
                  ? codex.reason
                  : 'Needs a one-time sign-in before agents can run on it'
        }
        origin={forced ? ENV : undefined}
        error={setup.error?.message ?? refresh.error?.message}
      >
        {!forced && (
          <>
            <Badge tone={codexReady ? 'good' : 'muted'}>{runtimes.isPending ? 'Checking…' : runtimes.isError ? "Couldn't check" : codexReady ? (codex?.account ? `Signed in as ${codex.account}` : 'Signed in') : 'Not set up'}</Badge>
            {codex?.reason === 'Set up Codex' && !setup.isSuccess && (
              <button type="button" data-action="agents.codex.setup" disabled={setup.isPending} onClick={() => setup.mutate()} className={small}>
                Set up Codex
              </button>
            )}
            {!codexReady && (setup.isSuccess || codex?.reason !== 'Set up Codex') && (
              <button type="button" data-action="agents.codex.check" disabled={refresh.isPending} onClick={() => refresh.mutate()} className={small}>
                {refresh.isPending ? 'Checking…' : 'Check again'}
              </button>
            )}
          </>
        )}
      </SettingRow>
      <SettingRow label="Demo engine" help="Built in · scripted answers, no AI usage · used while a store is on demo data">
        <Badge>{forced ? 'Every run, set by the environment' : 'Always on'}</Badge>
      </SettingRow>
    </SettingsSection>
  );
}

// The run limits (ST-22) are `runs.*` workspace entries, edited in the same form (one form per section).
const KEYS = ['runtime', 'model', 'effort', 'stopAfterMin', 'knowledge', 'retries', 'atOnce', 'perStore'] as const;
type Key = (typeof KEYS)[number];
type Values = { runtime?: 'claude' | 'codex'; model?: string; effort?: string; stopAfterMin?: number; knowledge?: 'all' | 'store'; retries?: number; atOnce?: number; perStore?: number };
type Form = Values & { version: number };
const id = (k: Key) => (k === 'retries' || k === 'atOnce' || k === 'perStore' ? `runs.${k}` : `agentDefaults.${k}`);

/** The values set at this scope (the store's own, or the workspace's); an unset one is absent. */
const own = (v: ConfigView, store?: string): Values => Object.fromEntries(KEYS.filter((k) => v.origins[id(k)] === (store ? 'store' : 'workspace')).map((k) => [k, v.values[id(k)]]));
const toForm = (v: ConfigView, store?: string): Form => ({ version: (store ? v.versions[`store_caps:${store}`] : v.versions.workspace) ?? 0, ...own(v, store) });
/** The changed keys as one document: a value set, or unset (back to the workspace's, or the runtime default). */
function documentsOf(changes: Partial<Form>, base: Form, store?: string) {
  const keys = KEYS.filter((k) => k in changes);
  const set = Object.fromEntries(keys.filter((k) => changes[k] !== undefined).map((k) => [id(k), changes[k]]));
  const unset = keys.filter((k) => changes[k] === undefined).map(id);
  return keys.length ? [{ doc: store ? 'store_caps' : 'workspace', ...(store ? { storeId: store } : {}), version: base.version, ...(unset.length < keys.length ? { set } : {}), ...(unset.length ? { unset } : {}) }] : [];
}

/** What a set of values runs as: the runtime, model and effort it names, else each one's default from GET /api/runtimes. */
function resolve(v: Values, all: RuntimeCapabilities[] | undefined) {
  const runtime = v.runtime ?? 'claude';
  const info = all?.find((r) => r.runtime === runtime);
  const models = info?.models ?? [];
  const fallback = models.find((m) => m.default) ?? models[0];
  const model = v.model === undefined ? fallback : models.find((m) => m.id === v.model);
  return { runtime, info, models, fallback, model, effort: v.effort ?? model?.defaultEffort };
}
const RUNTIME = { claude: 'Claude', codex: 'Codex' } as const;
const KNOWLEDGE = { all: "The store's and General", store: "The store's only" } as const;
const effortLabel = (e?: string) => (e ? (EFFORT_LABEL[e] ?? e) : 'none');

/** The defaults for new runs (decision 9), at the workspace or one store's scope (`?store=`). */
function Defaults() {
  const scope = useScope();
  const store = scope.store;
  const sid = store?.id;
  const qc = useQueryClient();
  const ws = useConfig();
  const q = useConfig(sid);
  const all = useRuntimes().data;
  const f = useSettingsForm<Form>({
    key: `agents:${sid ?? 'workspace'}`,
    saved: q.data && toForm(q.data, sid),
    labels: { runtime: 'Runtime', model: 'Model', effort: 'Effort', stopAfterMin: 'Stop a run after', knowledge: 'Knowledge', retries: 'Retries', atOnce: 'Runs at once', perStore: 'Runs at once per store' },
    save: (changes, _version, base) =>
      api<ConfigView>('/api/config', json('PATCH', { documents: documentsOf(changes, base, sid) })).then(
        (v) => (qc.setQueryData(['config', 'view', sid ?? null], v), { ...toForm(v, sid), changes: v.changes }),
        (e: ApiError) => {
          e.field = KEYS.find((k) => id(k) === e.field) ?? e.field; // the row's own key
          if (e.current) e.current = toForm(e.current as ConfigView, sid);
          throw e;
        },
      ),
    onSaved: () => void qc.invalidateQueries({ queryKey: ['config'] }),
  });
  const documents = q.data && f.dirty.length ? documentsOf(f.changes(), toForm(q.data, sid), sid) : [];
  const impact = useQuery({
    queryKey: ['config', 'impact', documents],
    queryFn: () => api<{ impacts: ConfigImpact[] }>('/api/config/impact', json('POST', { documents })),
    enabled: documents.length > 0,
  });
  const title = 'Defaults for new runs';
  if (!scope.ready || q.isPending || ws.isPending) return <SettingsSection title={title}><LoadingState rows={5} className="px-[18px] pb-4" /></SettingsSection>;
  if (q.isError || ws.isError) return <SettingsSection title={title}><ErrorState message="Couldn't load your settings." onRetry={() => (q.refetch(), ws.refetch())} /></SettingsSection>;

  const d = f.draft!;
  // What this scope falls back to: a store, the workspace's values; the workspace, each runtime's defaults.
  const inherited: Values = sid ? own(ws.data) : {};
  const merged = Object.fromEntries(KEYS.map((k) => [k, d[k] ?? inherited[k]])) as Values;
  const now = resolve(merged, all);
  const before = resolve(inherited, all);
  const named = now.info?.source === 'discovered' ? `your ${RUNTIME[now.runtime]} login` : "the app's model list";
  /** A newly picked model's effort: what this scope inherits when the model takes it, else the model's own default. */
  const effortFor = (m: (typeof now)['model']) => (inherited.effort === undefined || m?.efforts.includes(inherited.effort) ? undefined : m?.defaultEffort);
  const setModel = (model: string | undefined) => {
    const m = model === undefined ? resolve({ ...merged, model: inherited.model }, all).model : now.models.find((x) => x.id === model);
    f.set('model', model);
    f.set('effort', d.effort !== undefined && m?.efforts.includes(d.effort) ? d.effort : effortFor(m));
  };
  // Changing the runtime resets model and effort to that runtime's defaults (decision 9); a store keeps inheriting the
  // workspace's when they're for the same runtime. Codex needs a "Stop after": 20 minutes unless one is set.
  const setRuntime = (runtime: Values['runtime']) => {
    const next = runtime ?? inherited.runtime ?? 'claude';
    f.set('runtime', runtime);
    if (next === now.runtime) return;
    const m = resolve({ runtime: next }, all).fallback;
    const inherits = (inherited.runtime ?? 'claude') === next;
    f.set('model', inherits || inherited.model === undefined ? undefined : m?.id);
    f.set('effort', inherits ? undefined : effortFor(m));
    if (next === 'codex' && merged.stopAfterMin === undefined) f.set('stopAfterMin', 20);
  };
  /** The row's origin in a store's scope: inherited, or the store's own with the workspace's value and Use workspace default. */
  const origin = (k: Key, show: string, use = () => f.set(k, undefined)): Origin | undefined =>
    !sid ? undefined : d[k] === undefined ? { kind: 'workspace' } : { kind: 'store', workspace: show, same: same(d[k], inherited[k]), onUse: use };
  const row = (k: Key) => ({ setting: id(k), error: f.error(k), changed: f.dirty.includes(k) });
  const efforts = now.model?.efforts ?? [];
  /** A run limit as it stands: the draft's, else the workspace's (or its default). */
  const limit = (k: 'retries' | 'atOnce' | 'perStore') => Number(d[k] ?? q.data.values[id(k)]);
  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const texts = documents.length ? (impact.data?.impacts.map((i) => i.text) ?? []) : [];
  return (
    <>
      <SettingsSection
        title={title}
        help="Applies to runs started after you save. Runs already going keep the settings they started with."
        advanced={
          sid
            ? undefined
            : {
                summary: 'retries, runs at once',
                children: (
                  <>
                    <SettingRow {...row('retries')} label="Retries" htmlFor="run-retries" help="When the AI service is busy or failing, unless the run already changed something">
                      <select id="run-retries" data-setting="runs.retries" value={limit('retries')} onChange={(e) => f.set('retries', Number(e.target.value))} className={cx(inputClass, 'w-[220px] py-1.5')}>
                        <option value={0}>Never</option>
                        <option value={1}>Once</option>
                        <option value={2}>Twice</option>
                      </select>
                    </SettingRow>
                    {/* Lowering the total lowers per store with it: per store is never above the total. */}
                    <SettingRow {...row('atOnce')} label="Runs at once" htmlFor="run-total" help="Across every store. Lowering it never stops a run going.">
                      <select id="run-total" data-setting="runs.atOnce" value={limit('atOnce')} onChange={(e) => (f.set('atOnce', Number(e.target.value)), limit('perStore') > Number(e.target.value) && f.set('perStore', Number(e.target.value)))} className={cx(inputClass, 'w-[220px] py-1.5')}>
                        {upTo(5).map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </SettingRow>
                    <SettingRow {...row('perStore')} label="Runs at once per store" htmlFor="run-store" help="Never above the total. A team runs at most this many of its tasks at once.">
                      <select id="run-store" data-setting="runs.perStore" value={limit('perStore')} onChange={(e) => f.set('perStore', Number(e.target.value))} className={cx(inputClass, 'w-[220px] py-1.5')}>
                        {upTo(3).map((n) => (
                          <option key={n} disabled={n > limit('atOnce')}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                  </>
                ),
              }
        }
      >
        <SettingRow
          {...row('runtime')}
          label="Runtime"
          htmlFor="agent-runtime"
          help={store && !store.connected ? `Runs on the demo engine while ${store.name} is on demo data` : undefined}
          origin={store && !store.connected ? undefined : origin('runtime', RUNTIME[before.runtime], () => setRuntime(undefined))}
        >
          {store && !store.connected ? (
            <select id="agent-runtime" data-setting="agentDefaults.runtime" disabled value="demo" className={cx(inputClass, 'w-[220px] py-1.5 disabled:opacity-60')}>
              <option value="demo">Demo engine</option>
            </select>
          ) : (
            <select id="agent-runtime" data-setting="agentDefaults.runtime" value={now.runtime} onChange={(e) => setRuntime(e.target.value as 'claude' | 'codex')} className={cx(inputClass, 'w-[220px] py-1.5')}>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          )}
        </SettingRow>
        <SettingRow {...row('model')} label="Model" htmlFor="agent-model" help={`List from ${named}`} origin={origin('model', before.model?.label ?? inherited.model ?? 'runtime default', () => setModel(undefined))}>
          <select id="agent-model" data-setting="agentDefaults.model" value={merged.model ?? ''} onChange={(e) => setModel(e.target.value || undefined)} className={cx(inputClass, 'w-[220px] py-1.5')}>
            {merged.model === undefined || !sid ? <option value="">Runtime default{now.fallback ? ` (${now.fallback.label})` : ''}</option> : null}
            {merged.model !== undefined && !now.model && <option value={merged.model}>{merged.model}</option>}
            {now.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow {...row('effort')} label="Effort" help={efforts.length ? undefined : `${now.model?.label ?? 'This model'} takes no effort level`} origin={origin('effort', effortLabel(before.effort))}>
          {efforts.length > 0 && (
            <div data-setting="agentDefaults.effort" className="max-w-full overflow-x-auto">
              {/* Five levels outgrow a phone-width column: they scroll here rather than widen the page. */}
              <Segmented
                label="Effort"
                options={efforts.map((e) => ({ value: e, label: effortLabel(e), ...(now.runtime === 'codex' && e === 'ultra' ? { disabled: true, title: CODEX_ULTRA } : {}) }))}
                value={now.effort ?? ''}
                onChange={(e) => f.set('effort', e)}
              />
            </div>
          )}
        </SettingRow>
        <SettingRow {...row('stopAfterMin')} label="Stop a run after" htmlFor="agent-stop" help={`New conversations only${now.runtime === 'codex' ? ' · Codex needs it' : ''}`} origin={origin('stopAfterMin', inherited.stopAfterMin ? `${inherited.stopAfterMin} min` : 'no limit')}>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
            <input
              id="agent-stop"
              data-setting="agentDefaults.stopAfterMin"
              type="number"
              min={1}
              max={1440}
              step={1}
              value={d.stopAfterMin ?? ''}
              placeholder={inherited.stopAfterMin ? String(inherited.stopAfterMin) : 'No limit'}
              onChange={(e) => f.set('stopAfterMin', e.target.value === '' ? undefined : Number(e.target.value))}
              className={cx(inputClass, 'w-[110px] py-1.5')}
            />
            min
          </span>
        </SettingRow>
        <SettingRow {...row('knowledge')} label="Knowledge" htmlFor="agent-knowledge" help="What new runs can look up" origin={origin('knowledge', KNOWLEDGE[inherited.knowledge ?? 'all'])}>
          <select id="agent-knowledge" data-setting="agentDefaults.knowledge" value={merged.knowledge ?? 'all'} onChange={(e) => f.set('knowledge', e.target.value as 'all' | 'store')} className={cx(inputClass, 'w-[220px] py-1.5')}>
            <option value="all">{KNOWLEDGE.all}</option>
            <option value="store">{KNOWLEDGE.store}</option>
          </select>
        </SettingRow>
        {/* One behaviour, so a statement rather than a select (decision 9). */}
        <SettingRow label="If the runtime fails" help="Frontline never switches provider or model on its own.">
          <span className="text-[13px] text-text-2">Stop and notify me</span>
        </SettingRow>
        <p className="border-t border-line px-[18px] py-3 text-xs text-muted">
          Scheduled and background work runs on Claude on live stores and on the demo engine on demo stores (Knowledge research always runs on Claude); never on Codex. It takes the default model and effort when the default runtime is Claude.
        </p>
      </SettingsSection>
      <SaveBar {...f.bar} scope={store?.name ?? 'Workspace defaults'} impact={texts.length ? texts.map((t) => <span key={t} className="mt-0.5 block text-xs">{t}</span>) : undefined} />
      {f.dialogs}
    </>
  );
}
