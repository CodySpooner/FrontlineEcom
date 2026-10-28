import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { APPROVAL_KINDS, CODEX_ULTRA, EFFORT_LABEL, type AgentPermissions, type AgentPreset, type AgentTypeInfo, type ConversationDetail, type KnowledgeScope, type RuntimeCapabilities, type RuntimeId, type Store } from '@frontline/shared';
import { useAgents, useAgentTypes, useCaps, useChangeConfig, useCreateConversation, usePresets, useRefreshRuntimes, useRuntimes, useSavePreset, useSetUpCodex, useStores, useTypeTools } from '../api/client';
import { Button, cx, Dialog, Segmented, Switch } from '../components/ui';
import { withParams } from '../knowledge/url';
import { ago, money } from '../lib/format';
import { AttachButton, attachError, Attachments, toUploads } from './attach';
import { runtimeLabel } from './Conversation';
import { CustomRoleForm } from './CustomRoleForm';
import { ACCESS } from './Details';
import { autopilotRules, useAgentSettings } from './settings';
import { agentsUrl } from './urls';

// Deploy (decision 9): starts a conversation on a type, runtime, model and effort the server checks before anything
// runs; and "Change runtime or model…" (decision 10), which moves a conversation to a new config.

const label = 'text-[11px] font-semibold tracking-[.07em] text-muted uppercase';
/** A line chevron in place of the native select arrow, as on the boards. */
export const ARROW = 'appearance-none bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2024%2024%27%20fill=%27none%27%20stroke=%27%238b8b94%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27m6%209%206%206%206-6%27/%3E%3C/svg%3E)] bg-[length:14px] bg-[position:right_10px_center] bg-no-repeat';
const select = `h-[34px] w-full rounded-lg border border-[#2c2c33] bg-[#0c0c0f] pr-8 pl-2.5 text-[13px] text-[#e6e6ea] focus:border-red/60 focus:outline-none ${ARROW}`;
const input = 'h-[34px] rounded-lg border border-[#2c2c33] bg-[#0c0c0f] px-2.5 text-[13px] text-text placeholder:text-muted focus:border-red/60 focus:outline-none';
const warn = 'text-xs text-amber';

/** The board's 2–4 word line under each type tile; a custom role shows its own description. */
const SHORT: Record<string, string> = {
  product_hunter: 'Opportunities, evidence',
  ad_strategist: 'Campaigns and tests',
  creative_studio: 'Concepts and hooks',
  copywriter: 'Pages, ads, emails',
  market_analyst: 'Measured vs. guessed',
  store_developer: 'Theme, pages, speed',
  email_sms: 'Flows and campaigns',
  operations: 'Orders and suppliers',
  'builtin:marketing_strategist': 'Positioning, calendar',
  'builtin:general_researcher': 'Open questions',
};
/** The draft-producing tools a deploy can switch off; off removes the tool from the run (runTools). */
const DRAFTS: Record<string, string> = {
  draft_page: 'Draft pages',
  draft_theme_change: 'Draft theme changes',
  draft_flow: 'Draft email and SMS flows',
  create_creative: 'Make creatives',
  propose_ad_change: 'Propose ad pauses and budgets',
  propose_price_change: 'Propose price changes',
};

/** `?deploy=` opens Deploy; a type id preselects it (New conversation). */
export function useDeploy() {
  const [params, setParams] = useSearchParams();
  const set = (deploy?: string) => setParams((p) => withParams(p, { deploy }), { replace: true });
  return { type: params.get('deploy'), open: (type = '') => set(type), close: () => set(undefined) };
}

/** `?change=runtime` opens "Change runtime or model…" on the open conversation. */
export function useChangeRuntime() {
  const [params, setParams] = useSearchParams();
  const set = (change?: string) => setParams((p) => withParams(p, { change }), { replace: true });
  return { shown: params.get('change') === 'runtime', open: () => set('runtime'), close: () => set(undefined) };
}

export const DemoPill = () => <span className="rounded-full border border-dashed border-amber/55 px-2 py-0.5 text-[10px] font-semibold tracking-[.08em] whitespace-nowrap text-amber uppercase">Demo data</span>;

/** A refusal's text, on the field it names; `fields` lists the ones the form shows itself. */
function fieldErrors(error: Error | null, fields: string[]) {
  const e = error as (Error & { field?: string }) | null;
  return {
    said: (field: string) => e?.field === field && <span className="text-xs text-[#ff6b76]">{e.message}</span>,
    rest: e && !fields.includes(e.field ?? '') && <span role="alert" className="text-xs text-[#ff6b76]">{e.message}</span>,
  };
}

type Choice = { runtime: RuntimeId; model?: string; effort?: string };

/** Runtime, model and effort, resolved against what this machine can run: an unlisted model falls back to the default. */
function useRuntimeChoice(store: Store, start: Choice) {
  const [v, setV] = useState(start);
  const all = useRuntimes().data;
  const claude = all?.find((c) => c.runtime === 'claude');
  const codex = all?.find((c) => c.runtime === 'codex');
  // A demo store may run on the demo engine; a live one never does (decision 9).
  const runtime: RuntimeId = v.runtime === 'demo' && store.connected ? 'claude' : v.runtime;
  const info = runtime === 'claude' ? claude : runtime === 'codex' ? codex : undefined;
  const models = info?.models ?? [];
  const model = models.find((m) => m.id === v.model) ?? models.find((m) => m.default) ?? models[0];
  const usable = model?.efforts.filter((e) => runtime !== 'codex' || e !== 'ultra') ?? []; // never Codex's ultra (CODEX_ULTRA)
  const effort = model && (v.effort && usable.includes(v.effort) ? v.effort : model.defaultEffort && usable.includes(model.defaultEffort) ? model.defaultEffort : usable[0]);
  return { runtime, model, effort, models, claude, codex, info, set: (patch: Partial<Choice>) => setV((p) => ({ ...p, ...patch })), reset: setV, config: { runtime, ...(model ? { model: model.id } : {}), ...(effort ? { effort } : {}) } };
}

/** The picked runtime can't run here: what to do, with Codex's own "Set up Codex" and a check again (decision 9). */
function NotReady({ info }: { info: RuntimeCapabilities }) {
  const setup = useSetUpCodex();
  const refresh = useRefreshRuntimes();
  const fixable = info.runtime === 'codex' && (info.reason === 'Set up Codex' || info.reason === 'Install the Codex CLI');
  return (
    <span className="text-xs text-muted">
      {info.reason === 'Set up Codex' && info.runtime === 'codex' ? (
        setup.isSuccess ? (
          'Sign in to Codex in the browser window that opened, then check again.'
        ) : (
          <button type="button" disabled={setup.isPending} onClick={() => setup.mutate()} className="cursor-pointer text-[#ff6b76] hover:underline">
            Set up Codex
          </button>
        )
      ) : (
        info.reason
      )}
      {fixable && (
        <>
          {' · '}
          <button type="button" disabled={refresh.isPending} onClick={() => refresh.mutate()} className="cursor-pointer text-[#ff6b76] hover:underline">
            {refresh.isPending ? 'Checking…' : 'Check again'}
          </button>
        </>
      )}
      {setup.isError && <span className="block text-red">{setup.error.message}</span>}
    </span>
  );
}

function RuntimeFields({ store, choice, said }: { store: Store; choice: ReturnType<typeof useRuntimeChoice>; said: (field: string) => ReactNode }) {
  const { runtime, model, effort, models, claude, codex, info } = choice;
  const dot = (r?: RuntimeCapabilities) => <i aria-hidden className={cx('size-[7px] rounded-full', r?.connected && !r.reason ? 'bg-good' : 'bg-[#55555e]')} />;
  const options = [
    ...(store.connected ? [] : [{ value: 'demo' as RuntimeId, label: 'Demo (free)' }]),
    { value: 'claude' as RuntimeId, label: <>{dot(claude)}Claude</>, title: claude?.reason },
    ...(codex ? [{ value: 'codex' as RuntimeId, label: <>{dot(codex)}Codex</>, title: codex.reason }] : []),
  ];
  const from = info && (info.source === 'discovered' ? `your ${info.runtime === 'claude' ? 'Claude connection' : `Codex CLI ${info.version ?? ''}`}, checked ${ago(info.checkedAt)}` : `the app's model list (${info.registryVersion}); not confirmed on this account`);
  const caption =
    runtime === 'demo'
      ? "The app's demo engine answers with sample replies on this store's demo data. It costs nothing."
      : from && `Models and effort levels come from ${from}.${info?.source === 'discovered' && model?.effortsFromRegistry ? ` ${model.label}'s effort levels come from the app's model list.` : ''}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-1.5">
          <span className={label}>Runtime</span>
          <Segmented quiet label="Runtime" options={options} value={runtime} onChange={(r) => choice.set({ runtime: r })} />
          {info?.reason && <NotReady info={info} />}
          {said('runtime')}
        </div>
        {runtime !== 'demo' && (
          <label className="grid content-start gap-1.5">
            <span className={label}>Model</span>
            <select className={select} value={model?.id ?? ''} onChange={(e) => choice.set({ model: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {model?.description && (
              <span title={model.description} className="truncate text-[11.5px] text-muted">
                {model.description}
              </span>
            )}
            {said('model')}
          </label>
        )}
      </div>
      <div className="grid gap-1.5">
        {model && model.efforts.length > 0 && (
          <>
            <span className={label}>Effort</span>
            <Segmented
              quiet
              label="Effort"
              options={model.efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? e, ...(runtime === 'codex' && e === 'ultra' ? { disabled: true, title: CODEX_ULTRA } : {}) }))}
              value={effort ?? ''}
              onChange={(e) => choice.set({ effort: e })}
            />
          </>
        )}
        {said('effort')}
        {caption && <span className="text-[11.5px] text-muted">{caption}</span>}
        {model?.id.includes('fable') && <span className={warn}>Fable bills usage credits on your Claude plan, without asking each time.</span>}
        {runtime === 'codex' && <span className="text-[11.5px] text-muted">Codex replies appear when complete. It reports tokens, not dollars, so its runs stop after a time limit instead of a budget.</span>}
        {runtime !== 'demo' && !store.connected && <span className={warn}>This store has demo data: the agent works on sample numbers and uses your real {runtime === 'claude' ? 'Claude' : 'Codex'} usage.</span>}
      </div>
    </>
  );
}

function Fold({ title, summary, open, onToggle, children }: { title: string; summary: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-line">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center gap-2 px-3 py-[9px] text-left text-[13px] font-medium text-[#e6e6ea]">
        {open ? <ChevronDown aria-hidden className="size-3.5 text-muted" /> : <ChevronRight aria-hidden className="size-3.5 text-muted" />}
        {title}
        <span className="ml-auto truncate pl-3 text-xs font-normal text-muted">{summary}</span>
      </button>
      {open && <div className="px-3.5 pt-0.5 pb-3 pl-[34px]">{children}</div>}
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex min-h-7 items-center gap-2 py-1 text-[12.5px] text-text-2">{children}</div>;

/** Opens on the workspace's store and the type it was opened from (else the first); the store is fixed once it starts. */
export function Deploy({ store: initial, type: preselected, onClose }: { store: Store; type: string; onClose: () => void }) {
  const navigate = useNavigate();
  const settings = useAgentSettings();
  const stores = useStores().data ?? [initial];
  const [storeId, setStoreId] = useState(initial.id);
  const store = stores.find((s) => s.id === storeId) ?? initial;
  const types = useAgentTypes(store.id).data;
  const [typeId, setTypeId] = useState(preselected);
  const type = types?.find((t) => t.id === typeId) ?? types?.[0];
  const presets = usePresets(store.id, type?.id ?? '').data;
  const groups = useTypeTools(store.id, type?.id ?? '').data;
  const seat = useAgents().data?.find((a) => a.id === `${store.id}:${type?.baseRole}`);
  const caps = useCaps(store.id).data;
  const choice = useRuntimeChoice(store, { runtime: store.connected ? 'claude' : 'demo' });
  const create = useCreateConversation(store.id);
  const save = useSavePreset(store.id);
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [presetId, setPresetId] = useState<string>();
  const [off, setOff] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeScope[]>(['store', 'general']);
  const [budget, setBudget] = useState('');
  const [stopAfter, setStopAfter] = useState('');
  const [saveFindings, setSaveFindings] = useState<AgentPermissions['saveFindings']>('off');
  // Codex requires a Stop after (dollar caps don't apply to it): 20 minutes unless one is set (decision 9).
  useEffect(() => {
    if (choice.runtime === 'codex') setStopAfter((s) => s || '20');
  }, [choice.runtime]);
  const [objective, setObjective] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState<string>();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(true);
  const [naming, setNaming] = useState<string>();
  const [customRole, setCustomRole] = useState(false);

  const base = groups?.flatMap((g) => g.tools) ?? [];
  const drafts = base.filter((t) => Object.hasOwn(DRAFTS, t));
  const comparable = type?.id === 'market_analyst';
  const tools = [...base.filter((t) => !off.includes(t)), ...(comparable && compare ? ['compare_stores'] : [])];
  const rules = autopilotRules(seat?.autonomy, caps, tools);
  const suggested = objective.trim().split('\n')[0]!.slice(0, 80);
  const config = {
    ...choice.config,
    ...(off.length || compare ? { tools } : {}),
    knowledge,
    permissions: { ...(choice.runtime === 'claude' && budget ? { budgetUsd: Number(budget) } : {}), ...(stopAfter ? { stopAfterMin: Number(stopAfter) } : {}), saveFindings },
  };
  const created = fieldErrors(create.error, ['runtime', 'model', 'effort', 'tools', 'knowledge', 'permissions.budgetUsd', 'permissions.stopAfterMin', 'permissions.saveFindings', 'objective', 'attachments']);
  const saved = fieldErrors(save.error, ['name', 'runtime', 'model', 'effort', 'tools', 'knowledge', 'permissions.budgetUsd', 'permissions.stopAfterMin', 'permissions.saveFindings', 'objective']);
  const said = (field: string) => created.said(field) || saved.said(field);

  /** Fills every field from a preset; none is the type's Default. */
  const fill = (p: AgentPreset | undefined, t: AgentTypeInfo | undefined, s = store) => {
    const c = p?.config;
    choice.reset({ runtime: c?.runtime ?? (s.connected ? 'claude' : 'demo'), model: c?.model, effort: c?.effort });
    setOff(c?.tools ? Object.keys(DRAFTS).filter((d) => !c.tools!.includes(d)) : []);
    setCompare(!!c?.tools?.includes('compare_stores') && t?.id === 'market_analyst');
    setKnowledge(c?.knowledge ?? ['store', 'general']);
    setBudget(c?.permissions?.budgetUsd ? String(c.permissions.budgetUsd) : '');
    setStopAfter(c?.permissions?.stopAfterMin ? String(c.permissions.stopAfterMin) : '');
    setSaveFindings(c?.permissions?.saveFindings ?? 'off');
    if (c?.objective) setObjective(c.objective);
  };
  const pickType = (id: string) => {
    setTypeId(id);
    setPresetId(undefined);
    fill(undefined, types?.find((t) => t.id === id));
  };
  const pickPreset = (id: string) => {
    const p = presets?.find((x) => x.id === id);
    if (!p) return;
    // A preset saved for a custom role of this type selects that role.
    const role = p.config.customRoleId && types?.find((t) => t.id === p.config.customRoleId);
    if (role) setTypeId(role.id);
    setPresetId(p.builtin ? undefined : p.id);
    fill(p, role || type);
  };
  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!type || attachError(files)) return;
    const attachments = files.length ? await toUploads(files) : undefined;
    create.mutate(
      { clientRequestId, type: type.id, message: objective.trim(), title: (title ?? suggested).trim() || undefined, config, ...(attachments ? { attachments } : {}) },
      { onSuccess: (r) => navigate(agentsUrl({ store: store.id, conversation: r.conversation.id })) },
    );
  };
  const savePreset = () => {
    if (!type || naming === undefined) return;
    save.mutate({ name: naming, type: type.id, config, ...(objective.trim() ? { objective: objective.trim() } : {}) }, { onSuccess: (p) => (setPresetId(p.id), setNaming(undefined)) });
  };
  const toggle = (list: string[], item: string, on: boolean) => (on ? list.filter((x) => x !== item) : [...list, item]);

  const footer =
    naming === undefined ? (
      <div className="flex items-center gap-2.5">
        <span className="flex-1 text-xs text-muted">{created.rest || saved.rest || 'Checked by the app before it starts. An unsupported combination is refused with the reason.'}</span>
        <button type="button" disabled={!type} onClick={() => (save.reset(), setNaming(''))} className="cursor-pointer px-1 text-[13px] whitespace-nowrap text-text-2 hover:text-white">
          Save as preset
        </button>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" form="deploy-form" variant="primary" disabled={!type || !groups || create.isPending}>
          Start conversation
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2.5">
        <input autoFocus aria-label="Preset name" placeholder="Preset name" maxLength={60} value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), savePreset())} className={cx(input, 'min-w-0 flex-1')} />
        {saved.said('name') || saved.rest}
        <Button onClick={() => setNaming(undefined)}>Cancel</Button>
        <Button variant="primary" disabled={!naming.trim() || save.isPending} onClick={savePreset}>
          Save preset
        </Button>
      </div>
    );

  return (
    <Dialog open onClose={onClose} title="Deploy an agent" width={688} subtitle="Starts a new conversation. The store can't be changed after it starts." headerExtra={!store.connected && <DemoPill />} footer={footer}>
      <form id="deploy-form" onSubmit={start} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid content-start gap-1.5">
            <span className={label}>Store</span>
            <select
              className={select}
              value={store.id}
              onChange={(e) => {
                const s = stores.find((x) => x.id === e.target.value)!;
                setStoreId(s.id);
                setPresetId(undefined);
                fill(undefined, type, s);
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid content-start gap-1.5">
            <span className={label}>Start from a preset</span>
            <select className={select} value={presetId ?? presets?.[0]?.id ?? ''} onChange={(e) => pickPreset(e.target.value)}>
              {presets?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.builtin ? `${p.name} (Default)` : p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center">
            <span id="deploy-type" className={label}>
              Agent type
            </span>
            <button type="button" onClick={() => setCustomRole(true)} className="ml-auto cursor-pointer text-xs text-[#ff6b76] hover:underline">
              + Custom role
            </button>
          </div>
          <div role="radiogroup" aria-labelledby="deploy-type" className="grid grid-cols-4 gap-2">
            {types?.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === type?.id}
                title={t.description}
                onClick={() => pickType(t.id)}
                className={cx('grid cursor-pointer gap-0.5 rounded-[9px] border px-2.5 py-2 text-left text-[13px] font-medium', t.id === type?.id ? 'border-red-fill bg-[rgba(255,42,58,.07)] text-white' : 'border-[#26262c] bg-[#0d0d10] text-[#e6e6ea] hover:border-line-2')}
              >
                <span className="truncate">{t.name}</span>
                <span className="truncate text-[11.5px] font-normal text-muted">{SHORT[t.id] ?? t.description}</span>
              </button>
            ))}
          </div>
        </div>
        <RuntimeFields store={store} choice={choice} said={said} />
        <label className="grid gap-1.5">
          <span className="flex items-center gap-2">
            <span className={label}>Conversation title</span>
            {title === undefined && suggested && <span className="rounded bg-[#1d1d22] px-1.5 py-px text-[10.5px] font-semibold text-text-2">Suggested</span>}
          </span>
          <input className={cx(input, 'w-full')} maxLength={200} value={title ?? suggested} onChange={(e) => setTitle(e.target.value)} placeholder="From the objective" />
        </label>
        <label className="grid gap-1.5">
          <span className={label}>Objective</span>
          <textarea required rows={3} maxLength={20000} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should the agent do? This is the first message." className={cx(input, 'h-[70px] w-full resize-none py-2')} />
          {said('objective')}
        </label>
        <Fold title="Tools and knowledge" summary={`${knowledgeLabel(knowledge)} · ${base.length} tools${files.length ? ` · ${files.length} attached` : ''}`} open={toolsOpen} onToggle={() => setToolsOpen(!toolsOpen)}>
          <ul className="grid gap-1">
            {groups?.map((g) => (
              <li key={g.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-text-2">{g.name}</span>
                <span className="text-right text-xs text-muted">
                  {g.integration && !g.tools.length && choice.runtime === 'codex' ? (
                    'Claude only for now'
                  ) : g.integration && !g.integration.connected ? (
                    <>
                      Not connected ·{' '}
                      <Link to="/integrations" className="text-[#ff6b76] hover:underline">
                        Set up
                      </Link>
                    </>
                  ) : (
                    ACCESS[g.access]
                  )}
                </span>
              </li>
            ))}
          </ul>
          <fieldset className="mt-2.5 grid gap-1">
            <legend className="pb-1 text-xs text-muted">Knowledge (never another store's)</legend>
            {(['store', 'general'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-[12.5px] text-text-2">
                <input type="checkbox" checked={knowledge.includes(k)} onChange={() => setKnowledge(toggle(knowledge, k, knowledge.includes(k)) as KnowledgeScope[])} className="accent-red-fill" />
                {k === 'store' ? `${store.name}'s knowledge` : 'General knowledge'}
              </label>
            ))}
          </fieldset>
          {comparable && (
            <label className="mt-2.5 flex items-center gap-2.5 text-[12.5px] text-text-2">
              <Switch checked={compare} onChange={() => setCompare(!compare)} />
              Compare with my other stores
              <span className="text-xs text-muted">their names, platforms, niches and totals</span>
            </label>
          )}
          <div className="mt-2.5 grid gap-1">
            <span className="text-xs text-muted">Attachments (sent with the first message)</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <AttachButton files={files} onChange={setFiles} />
              <Attachments files={files} onChange={setFiles} />
            </div>
            {attachError(files) && (
              <p role="alert" className="text-xs text-red">
                {attachError(files)}
              </p>
            )}
          </div>
          {said('tools')}
          {said('knowledge')}
          {said('attachments')}
        </Fold>
        <Fold title="Permissions and limits" summary={rules.length ? 'Autopilot within caps' : 'Asks before spending'} open={limitsOpen} onToggle={() => setLimitsOpen(!limitsOpen)}>
          <div className="grid grid-cols-2 gap-x-5">
            <Row>
              Ask before spending money
              <span className="ml-auto flex items-center gap-1.5 text-right text-[11.5px] text-muted">
                <Lock aria-hidden className="size-3 shrink-0" />
                <span>
                  {rules.length ? `Autopilot: ${rules.map(([k, v]) => `${APPROVAL_KINDS[k]?.label ?? k} up to ${money(v.maxUsdPerDay)}/day`).join(', ')}` : 'Always'}
                  {rules.length > 0 && store.id === initial.id && type && (
                    <>
                      {' · '}
                      <button type="button" onClick={() => (onClose(), settings.open(type.baseRole))} className="cursor-pointer text-[#ff6b76] hover:underline">
                        Agent settings
                      </button>
                    </>
                  )}
                </span>
              </span>
            </Row>
            <Row>
              Ask before publishing
              <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted">
                <Lock aria-hidden className="size-3" />
                Always
              </span>
            </Row>
            {drafts.map((d) => (
              <label key={d} className="flex min-h-7 items-center gap-2 py-1 text-[12.5px] text-text-2">
                {DRAFTS[d]}
                <span className="ml-auto flex">
                  <Switch checked={!off.includes(d)} onChange={() => setOff(toggle(off, d, off.includes(d)))} />
                </span>
              </label>
            ))}
            {choice.runtime === 'claude' && (
              <label className="flex min-h-7 items-center gap-2 py-1 text-[12.5px] text-text-2">
                Budget for this run
                <span className="ml-auto flex items-center gap-1 text-xs text-muted">
                  $<input type="number" min="0.01" step="0.01" aria-label="Budget for this run" placeholder="No limit" value={budget} onChange={(e) => setBudget(e.target.value)} className={cx(input, 'h-7 w-24 text-right')} />
                </span>
              </label>
            )}
            <label className="flex min-h-7 items-center gap-2 py-1 text-[12.5px] text-text-2">
              Stop after
              <span className="ml-auto flex items-center gap-1 text-xs text-muted">
                <input type="number" min="1" step="1" aria-label="Stop after" placeholder={choice.runtime === 'codex' ? 'Required' : 'No limit'} value={stopAfter} onChange={(e) => setStopAfter(e.target.value)} className={cx(input, 'h-7 w-24 text-right')} />
                min
              </span>
            </label>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-text-2">
            Save findings to knowledge
            <span className="ml-auto w-[360px] max-w-full">
              <Segmented
                quiet
                label="Save findings to knowledge"
                value={saveFindings}
                onChange={setSaveFindings}
                options={[
                  { value: 'ask', label: 'Ask me' },
                  { value: 'auto', label: 'Automatically (unreviewed)' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </span>
          </div>
          {saveFindings !== 'off' && !store.connected && <p className="mt-1 text-xs text-muted">Findings from demo data are removed when the store goes live.</p>}
          {said('permissions.budgetUsd')}
          {said('permissions.stopAfterMin')}
          {said('permissions.saveFindings')}
        </Fold>
      </form>
      {customRole && <CustomRoleForm store={store} open onClose={() => setCustomRole(false)} onCreated={(role) => pickType(role.id)} />}
    </Dialog>
  );
}

/** Decision 10: a new config with the same tools, knowledge and limits; the next reply starts a new session from a recap. */
export function ChangeRuntime({ store, conversation, onClose }: { store: Store; conversation: ConversationDetail; onClose: () => void }) {
  const choice = useRuntimeChoice(store, conversation.config);
  const change = useChangeConfig(store.id, conversation.id);
  const { said, rest } = fieldErrors(change.error, ['runtime', 'model', 'effort', 'permissions.stopAfterMin']);
  const same = runtimeLabel(choice.config) === runtimeLabel(conversation.config);
  // Moving to Codex takes a Stop after (20 minutes unless the conversation had one); a run budget doesn't move (decision 9).
  const [stopAfter, setStopAfter] = useState(String(conversation.config.permissions.stopAfterMin ?? 20));
  const toCodex = choice.runtime === 'codex';
  return (
    <Dialog
      open
      onClose={onClose}
      title="Change runtime or model"
      width={560}
      subtitle="The history stays here; the next reply starts a new session from a summary of this conversation."
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <span className="flex-1">{rest}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" title={same ? 'Pick a different runtime, model or effort' : undefined} disabled={same || change.isPending} onClick={() => change.mutate({ ...choice.config, ...(toCodex ? { stopAfterMin: Number(stopAfter) } : {}) }, { onSuccess: onClose })}>
            Switch
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <RuntimeFields store={store} choice={choice} said={said} />
        {toCodex && (
          <label className="flex items-center gap-2 text-[12.5px] text-text-2">
            Stop after
            <input type="number" min="1" step="1" aria-label="Stop after" value={stopAfter} onChange={(e) => setStopAfter(e.target.value)} className={cx(input, 'h-7 w-24 text-right')} />
            <span className="text-xs text-muted">min{conversation.config.permissions.budgetUsd ? '. The run budget stays with Claude.' : ''}</span>
          </label>
        )}
        {said('permissions.stopAfterMin')}
      </div>
    </Dialog>
  );
}

export const knowledgeLabel = (k: KnowledgeScope[]) =>
  k.length === 2 ? 'Store + General knowledge' : k[0] === 'store' ? 'Store knowledge' : k[0] === 'general' ? 'General knowledge' : 'No knowledge';
