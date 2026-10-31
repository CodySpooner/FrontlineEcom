import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Lock, Plus, X } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { CODEX_ULTRA, settingsUrl, type AgentConfig, type AgentTypeInfo, type ConversationConfigInput, type SquadMission, type Store, type TeamParticipantInput } from '@frontline/shared';
import { conversationQuery, useAgentTypes, useConfig, useConversation, useConversations, useCreateTeam, useRuntimes, useStores, useTeamAction } from '../api/client';
import { Button, cx, Dialog } from '../components/ui';
import { withParams } from '../knowledge/url';
import { runtimeLabel } from './Conversation';
import { ARROW, DemoPill } from './Deploy';
import { agentsUrl } from './urls';

// Create team (decision 12): a shared objective, up to six participants (each a type and a runtime · model · effort,
// new or lent by one of the store's conversations of that type), the lead, and the team's limits. Add agent reuses
// the participant row while the lead is still planning.

const label = 'text-[11px] font-semibold tracking-[.07em] text-muted uppercase';
const select = `h-[34px] w-full min-w-0 rounded-lg border border-[#2c2c33] bg-[#0c0c0f] pr-8 pl-2.5 text-[13px] text-[#e6e6ea] focus:border-red/60 focus:outline-none ${ARROW}`;
const input = 'h-[34px] rounded-lg border border-[#2c2c33] bg-[#0c0c0f] px-2.5 text-[13px] text-text placeholder:text-muted focus:border-red/60 focus:outline-none';
const small = `ml-auto h-7 w-20 rounded-lg border border-[#2c2c33] bg-[#0c0c0f] pr-8 pl-2 text-[13px] text-[#e6e6ea] focus:border-red/60 focus:outline-none ${ARROW}`;
const error = 'text-xs text-[#ff6b76]';

/** `?create=team` opens Create team; `&from=<conversation>` is Collaborate (that conversation's agent leads). */
export function useTeamDialog() {
  const [params, setParams] = useSearchParams();
  return {
    shown: params.get('create') === 'team',
    from: params.get('from') ?? undefined,
    open: (from?: string) => setParams((p) => withParams(p, { create: 'team', from }), { replace: true }),
    close: () => setParams((p) => withParams(p, { create: undefined, from: undefined }), { replace: true }),
  };
}

type Combo = { value: string; label: string; config: ConversationConfigInput; disabled?: string };
const comboOf = (c: Pick<AgentConfig, 'runtime' | 'model' | 'effort'>) => [c.runtime, c.model ?? '', c.effort ?? ''].join('|');

/** Every runtime · model · effort this machine lists. Codex's ultra and a runtime that can't run here show why they're off. */
function useCombos(store: Store): Combo[] {
  const runtimes = useRuntimes().data ?? [];
  return [
    ...(store.connected ? [] : [{ value: comboOf({ runtime: 'demo' }), label: 'Demo (free)', config: { runtime: 'demo' as const } }]),
    ...runtimes.flatMap((r) =>
      r.models.flatMap((m) =>
        (m.efforts.length ? m.efforts : ['']).map((e) => {
          const c = { runtime: r.runtime, model: m.id, ...(e ? { effort: e } : {}) };
          // Codex has no dollar caps: its steps stop after 20 minutes, as Deploy's default (decision 9).
          const config = r.runtime === 'codex' ? { ...c, permissions: { stopAfterMin: 20 } } : c;
          const off = r.reason ?? (r.runtime === 'codex' && e === 'ultra' ? CODEX_ULTRA : undefined);
          return { value: comboOf(c), label: runtimeLabel(c)!, config, ...(off ? { disabled: off } : {}) };
        }),
      ),
    ),
  ];
}

/** The usable default: Claude's default model and effort on a live store, the demo engine on a demo one. */
function defaultCombo(combos: Combo[], runtimes: ReturnType<typeof useRuntimes>['data']) {
  const usable = combos.filter((c) => !c.disabled);
  const claude = runtimes?.find((r) => r.runtime === 'claude')?.models.find((m) => m.default);
  return usable.find((c) => c.config.runtime === 'demo') ?? usable.find((c) => claude && c.config.model === claude.id && (c.config.effort ?? '') === (claude.defaultEffort ?? '')) ?? usable[0];
}

type Draft = { key: string; type: string; combo?: string; from?: string };

/** One participant: its type, runtime · model · effort, and New or a conversation of that type that lends its config. */
function ParticipantRow({ label: group, store, types, combos, row, combo, onChange, extra, said }: { label: string; store: Store; types: AgentTypeInfo[]; combos: Combo[]; row: Draft; combo?: string; onChange: (patch: Partial<Draft>) => void; extra?: ReactNode; said?: ReactNode }) {
  const lenders = useConversations(store.id, { type: row.type }).data?.pages.flatMap((p) => p.items) ?? [];
  const name = types.find((t) => t.id === row.type)?.name ?? 'Participant';
  return (
    <div role="group" aria-label={group} className="grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)_auto] items-center gap-2">
        <select aria-label="Agent type" className={select} value={row.type} onChange={(e) => onChange({ type: e.target.value, from: undefined, combo: undefined })}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label={`${name}: runtime, model and effort`} className={select} value={combo ?? ''} onChange={(e) => onChange({ combo: e.target.value })}>
          {combos.map((c) => (
            <option key={c.value} value={c.value} disabled={!!c.disabled} title={c.disabled}>
              {c.disabled ? `${c.label} (unavailable)` : c.label}
            </option>
          ))}
        </select>
        <select aria-label={`${name}: new or from a conversation`} className={select} value={row.from ?? ''} onChange={(e) => onChange({ from: e.target.value || undefined, combo: undefined })}>
          <option value="">New</option>
          {lenders.map((c) => (
            <option key={c.id} value={c.id}>
              Use “{c.title}”
            </option>
          ))}
        </select>
        <span className="flex items-center gap-2">{extra}</span>
      </div>
      {combos.find((c) => c.value === combo)?.disabled && <span className="text-xs text-muted">{combos.find((c) => c.value === combo)!.disabled}</span>}
      {row.from && <span className="text-xs text-muted">Lends its settings and a recap for this participant's first task; the conversation itself isn't changed.</span>}
      {said}
    </div>
  );
}

/** The participants' effective combos: a picked one, else a lending conversation's config, else the default. */
function useEffective(store: Store, rows: Draft[], combos: Combo[]) {
  const runtimes = useRuntimes().data;
  const lent = useQueries({ queries: rows.map((r) => conversationQuery(store.id, r.from ?? '')) });
  const fallback = defaultCombo(combos, runtimes)?.value;
  return rows.map((r, i) => r.combo ?? (r.from ? (lent[i]!.data ? comboOf(lent[i]!.data!.config) : undefined) : fallback));
}

/** The API's participant: a lent config goes as is; a changed or new one goes as its runtime, model and effort. */
const toInput = (r: Draft, combo: string | undefined, combos: Combo[]): TeamParticipantInput => ({
  type: r.type,
  ...(r.from ? { fromConversationId: r.from } : {}),
  ...(!r.from || r.combo ? { config: combos.find((c) => c.value === combo)?.config } : {}),
});

/** The refusal's text under the field it names: `participants.<i>` under that row, else the footer. */
const fieldOf = (e: Error | null) => (e as (Error & { field?: string }) | null)?.field ?? '';

export function CreateTeam({ store: initial, from, onClose }: { store: Store; from?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const stores = useStores().data ?? [initial];
  const [storeId, setStoreId] = useState(initial.id);
  const store = stores.find((s) => s.id === storeId) ?? initial;
  const types = useAgentTypes(store.id).data;
  const combos = useCombos(store);
  // Collaborate: the conversation's agent leads, lending its settings, and its title seeds the objective.
  const source = useConversation(initial.id, from ?? '').data;
  const next = useRef(1);
  const [picked, setRows] = useState<Draft[]>();
  const rows = picked ?? (from ? (source ? [{ key: 'r0', type: source.type, from: source.id }] : []) : types?.[0] ? [{ key: 'r0', type: types[0].id }] : []);
  const [lead, setLead] = useState('r0');
  const [typed, setObjective] = useState<string>();
  const objective = typed ?? source?.title ?? '';
  const [budget, setBudget] = useState('');
  // The server keeps "at once" to the store's runs at once (Settings' run limits, decision 9; never above the total).
  const values = useConfig().data?.values;
  const perStore = Math.min(Number(values?.['runs.perStore'] ?? 2), Number(values?.['runs.atOnce'] ?? 3));
  const [chosen, setAtOnce] = useState<number>();
  const atOnce = Math.min(chosen ?? 2, perStore);
  const [retries, setRetries] = useState(2);
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const create = useCreateTeam(store.id);
  const effective = useEffective(store, rows, combos);
  const claude = effective.some((c) => c?.startsWith('claude|'));
  const ordered = [...rows.filter((r) => r.key === lead), ...rows.filter((r) => r.key !== lead)];
  const field = fieldOf(create.error);
  const rowError = (r: Draft) => {
    const i = /^participants\.(\d+)/.exec(field)?.[1];
    return i !== undefined && ordered[Number(i)]?.key === r.key && <span className={error}>{create.error!.message}</span>;
  };
  const set = (key: string, patch: Partial<Draft>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => {
    const left = rows.filter((r) => r.key !== key);
    setRows(left);
    if (key === lead) setLead(left[0]!.key);
  };
  const start = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        clientRequestId,
        title: objective.trim().split('\n')[0]!.slice(0, 80),
        objective: objective.trim(),
        participants: ordered.map((r) => toInput(r, effective[rows.indexOf(r)], combos)),
        ...(claude && budget ? { budgetUsd: Number(budget) } : {}),
        maxConcurrent: atOnce,
        retries,
      },
      { onSuccess: (t) => navigate(agentsUrl({ store: store.id, team: t.id })) },
    );
  };
  const unavailable = useRuntimes().data?.filter((r) => r.reason) ?? [];
  const footer = (
    <div className="flex items-center gap-2.5">
      <span className="flex-1 text-xs text-muted">
        {create.error && !/^participants\.\d|^(budgetUsd|maxConcurrent|retries)$/.test(field) ? (
          <span role="alert" className={error}>
            {create.error.message}
          </span>
        ) : (
          'Checked by the app before it starts. An unsupported combination is refused with the reason.'
        )}
      </span>
      <Button onClick={onClose}>Cancel</Button>
      <Button type="submit" form="team-form" variant="primary" title={objective.trim().length < 10 ? 'Write a shared objective of at least 10 characters' : undefined} disabled={!rows.length || objective.trim().length < 10 || create.isPending}>
        Start team
      </Button>
    </div>
  );
  return (
    <Dialog open onClose={onClose} title="Create a team" width={688} subtitle="The lead plans the work, each participant does its part, and the lead writes the synthesis." headerExtra={!store.connected && <DemoPill />} footer={footer}>
      <form id="team-form" onSubmit={start} className="grid gap-4">
        <label className="grid gap-1.5">
          <span className={label}>Store</span>
          <select
            className={select}
            value={store.id}
            onChange={(e) => {
              setStoreId(e.target.value);
              setRows(undefined);
              setLead('r0');
            }}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className={label}>Shared objective</span>
          <textarea required rows={3} minLength={10} maxLength={4000} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What should the team get done? The lead plans from this." className={cx(input, 'h-[70px] w-full resize-none py-2')} />
        </label>
        <div role="radiogroup" aria-label="Lead" className="grid gap-2">
          <span className={label}>Participants · {rows.length}</span>
          {types &&
            rows.map((r, i) => (
              <ParticipantRow
                key={r.key}
                label={`Participant ${i + 1}`}
                store={store}
                types={types}
                combos={combos}
                row={r}
                combo={effective[i]}
                onChange={(patch) => set(r.key, patch)}
                said={rowError(r)}
                extra={
                  <>
                    <label className="flex items-center gap-1.5 text-[12.5px] text-text-2">
                      <input type="radio" name="lead" checked={lead === r.key} onChange={() => setLead(r.key)} className="accent-red-fill" />
                      Lead
                    </label>
                    <button type="button" aria-label="Remove participant" title={rows.length === 1 ? 'A team needs at least one participant' : undefined} disabled={rows.length === 1} onClick={() => remove(r.key)} className="grid size-6 cursor-pointer place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-white disabled:invisible">
                      <X className="size-3.5" />
                    </button>
                  </>
                }
              />
            ))}
          {rows.length < 6 && types?.[0] && (
            <button type="button" onClick={() => setRows([...rows, { key: `r${next.current++}`, type: types[0]!.id }])} className="flex cursor-pointer items-center gap-1 justify-self-start text-xs text-[#ff6b76] hover:underline">
              <Plus aria-hidden className="size-3.5" /> Add participant
            </button>
          )}
          {unavailable.map((r) => (
            <span key={r.runtime} className="text-xs text-muted">
              {r.runtime === 'claude' ? 'Claude' : 'Codex'} isn't available here: {r.reason}
            </span>
          ))}
        </div>
        <div className="grid gap-1.5">
          <span className={label}>Limits</span>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1 rounded-[10px] border border-line px-3.5 py-2 text-[12.5px] text-text-2">
            {claude && (
              <label className="flex min-h-8 items-center gap-2">
                Team budget
                <span className="ml-auto flex items-center gap-1 text-xs text-muted">
                  $<input type="number" min="0.01" step="0.01" aria-label="Team budget" placeholder="No limit" value={budget} onChange={(e) => setBudget(e.target.value)} className={cx(input, 'h-7 w-24 text-right')} />
                </span>
              </label>
            )}
            <label className="flex min-h-8 items-center gap-2">
              At once
              <select aria-label="At once" value={atOnce} onChange={(e) => setAtOnce(Number(e.target.value))} className={small}>
                {Array.from({ length: perStore }, (_, i) => i + 1).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="flex min-h-8 items-center gap-2">
              Retries per task
              <select aria-label="Retries per task" value={retries} onChange={(e) => setRetries(Number(e.target.value))} className={small}>
                {[0, 1, 2].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <span className="flex min-h-8 items-center gap-2">
              Sub-teams
              <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-muted">
                <Lock aria-hidden className="size-3" />
                Off
              </span>
            </span>
          </div>
          <span className="text-xs text-muted">
            Tasks run at most {perStore} at once per store ·{' '}
            <Link to={settingsUrl('agents', { setting: 'runs.perStore' })} className="text-[#ff6b76] hover:underline">
              Settings
            </Link>
          </span>
          {claude && <span className="text-xs text-muted">The team budget counts Claude participants only.</span>}
          {/^(budgetUsd|maxConcurrent|retries)$/.test(field) && <span className={error}>{create.error!.message}</span>}
        </div>
      </form>
    </Dialog>
  );
}

/** Add agent: one more participant, accepted until the lead's plan is in (decision 12). */
export function AddAgent({ store, team, onClose }: { store: Store; team: SquadMission; onClose: () => void }) {
  const types = useAgentTypes(store.id).data;
  const combos = useCombos(store);
  const [picked, setRow] = useState<Draft>();
  const row = picked ?? (types?.[0] ? { key: 'r0', type: types[0].id } : undefined);
  const [combo] = useEffective(store, row ? [row] : [], combos);
  const add = useTeamAction(store.id, team.id);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add agent"
      width={688}
      subtitle="Joins before the lead's plan is in, so the plan can give it a task."
      footer={
        <div className="flex items-center gap-2.5">
          <span className="flex-1">{add.error && !fieldOf(add.error).startsWith('participant') && <span role="alert" className={error}>{add.error.message}</span>}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!row || add.isPending} onClick={() => row && add.mutate({ path: 'participants', body: toInput(row, combo, combos) }, { onSuccess: onClose })}>
            Add
          </Button>
        </div>
      }
    >
      {types && row && <ParticipantRow label="New participant" store={store} types={types} combos={combos} row={row} combo={combo} onChange={(patch) => setRow({ ...row, ...patch })} said={fieldOf(add.error).startsWith('participant') && <span className={error}>{add.error!.message}</span>} />}
    </Dialog>
  );
}
