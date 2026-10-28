import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, Lock, X } from 'lucide-react';
import { AGENT_ROLES, CODEX_TESTED, EFFORT_LABEL, INTEGRATION_KINDS, INTERRUPTED, KB_STAGES, type AgentRole, type AgentRunDetail, type AgentTypeInfo, type ConversationDetail, type IntegrationKind, type Store, type ToolGroup } from '@frontline/shared';
import { useAgents, useAgentTypes, useCaps, useClaudeAccount, useConversation, useConversationFindings, useConversationKnowledge, useConversationTools, useRuntimes, useThread } from '../api/client';
import { FixLink } from '../components/Chat';
import { STATUS } from '../knowledge/Library';
import { cx, Dialog, ProgressBar, RUN_STATUS } from '../components/ui';
import { cents, modelName } from '../lib/format';
import { isLive } from '../lib/transcript';
import { took } from './activity';
import { runtimeLabel, spendLabel } from './Conversation';
import { useChangeRuntime } from './Deploy';
import { approvalLines, autopilotRules } from './settings';

// The right panel: the open conversation's Details (agent, runtime, store scope, tools, approvals and budget), its
// Activity (every run, newest first) and its Knowledge (the cards the latest reply used). With a team open, the
// workspace shows the team variant (Team.tsx TeamDetails) instead.

const TABS = [
  { value: 'details', label: 'Details' },
  { value: 'activity', label: 'Activity' },
  { value: 'knowledge', label: 'Knowledge' },
] as const;
export type DetailsTab = (typeof TABS)[number]['value'];
export const ACCESS: Record<ToolGroup['access'], string> = { read: 'Read', approval: 'Drafts need approval', on: 'On' };

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="relative flex flex-col gap-1.5 border-b border-[#1d1d22] px-4 py-3.5">
    <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">{title}</h3>
    {children}
  </section>
);

/** The thread's runs, oldest first (the pages come newest first). */
const runsOf = (pages?: { items: AgentRunDetail[] }[]) => [...(pages ?? [])].reverse().flatMap((p) => p.items);

/** `end`: beside the tabs (the hide button). The workspace keeps the tab per browser, so it's still picked after leaving the page. */
export function Details({ store, conversationId, end, tab, onTab }: { store: Store; conversationId?: string; end?: ReactNode; tab: DetailsTab; onTab: (tab: DetailsTab) => void }) {
  const c = useConversation(store.id, conversationId ?? '').data;
  const cards = useConversationKnowledge(store.id, conversationId ?? '').data?.length;
  return (
    <>
      <div role="tablist" aria-label="Details panel" className="flex h-10 shrink-0 items-center gap-4 border-b border-[#1d1d22] pr-2 pl-4">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => onTab(t.value)}
            className={cx('flex h-full cursor-pointer items-center gap-1.5 border-b-2 text-[12.5px] font-medium', tab === t.value ? 'border-red text-text' : 'border-transparent text-muted hover:text-white')}
          >
            {t.label}
            {t.value === 'knowledge' && !!cards && ' '}
            {t.value === 'knowledge' && !!cards && <span className="rounded bg-[#1d1d22] px-1.5 text-[10.5px] text-text-2">{cards}</span>}
          </button>
        ))}
        <span className="flex-1" />
        {end}
      </div>
      {!conversationId || !c ? (
        <p className="px-4 py-3.5 text-[12.5px] text-muted">Open a conversation to see its agent and scope.</p>
      ) : (
        <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)!.label} className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'details' ? <DetailsTab store={store} c={c} /> : tab === 'activity' ? <ActivityTab store={store} c={c} /> : <KnowledgeTab store={store} c={c} />}
        </div>
      )}
    </>
  );
}

export const toolLabel = (tool: string) => INTEGRATION_KINDS[tool as IntegrationKind]?.name ?? tool.replaceAll('_', ' ');

/** "Role instructions and checks": the type's contract, which its prompt is built from (decision 2). */
export function ContractDialog({ type, open, onClose }: { type: AgentTypeInfo; open: boolean; onClose: () => void }) {
  const c = type.contract;
  const part = (title: string, body: ReactNode) => (
    <section className="grid gap-1.5">
      <h3 className="text-[11px] font-semibold tracking-[.07em] text-muted uppercase">{title}</h3>
      {body}
    </section>
  );
  const items = (list: string[], ordered = false) => {
    const List = ordered ? 'ol' : 'ul';
    return (
      <List className={cx('grid gap-1 pl-4 text-[13px] text-text-2', ordered ? 'list-decimal' : 'list-disc')}>
        {list.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </List>
    );
  };
  return (
    <Dialog open={open} onClose={onClose} title={`${type.name}: role instructions and checks`}>
      <div className="grid gap-4 text-[13px] text-text-2">
        {part('Responsibility', <p>{c.responsibility}</p>)}
        {part('Measured on', <p>{c.kpi}</p>)}
        {part('Workflow', items(c.workflow, true))}
        {part(
          'Tools and knowledge',
          <>
            <p>{c.tools.map(toolLabel).join(', ')}</p>
            <p>Knowledge areas: {c.knowledge.join(', ')}</p>
          </>,
        )}
        {part('Outputs', items(c.outputs))}
        {part('Quality checks', items(c.checks))}
        {c.instructions && part('Your instructions', <p className="whitespace-pre-wrap">{c.instructions}</p>)}
      </div>
    </Dialog>
  );
}

function DetailsTab({ store, c }: { store: Store; c: ConversationDetail }) {
  const role = c.agentId.split(':')[1] as AgentRole;
  const type = useAgentTypes(store.id).data?.find((t) => t.id === c.type);
  const seat = useAgents().data?.find((a) => a.id === c.agentId);
  const caps = useCaps(store.id).data;
  const tools = useConversationTools(store.id, c.id).data;
  const runs = runsOf(useThread(store.id, c.id).data?.pages);
  const claude = useClaudeAccount(c.config.runtime === 'claude').q.data;
  const codex = useRuntimes().data?.find((r) => r.runtime === 'codex');
  const latest = runs.at(-1);
  const first = runs.find((r) => r.runtime);
  const rules = autopilotRules(seat?.autonomy, caps, c.config.tools);
  const { budgetUsd, stopAfterMin } = c.config.permissions;
  const compares = c.config.tools.includes('compare_stores');
  const [contract, setContract] = useState(false);
  const change = useChangeRuntime();
  return (
    <>
      <Section title="Agent">
        <div className="text-sm font-semibold">{type?.name ?? AGENT_ROLES[role]?.name ?? 'Agent'}</div>
        <p className="text-[12.5px] text-text-2">{type?.description ?? AGENT_ROLES[role]?.blurb}</p>
        {type && (
          <>
            <button type="button" onClick={() => setContract(true)} className="cursor-pointer self-start text-[12.5px] text-[#ff6b76] hover:underline">
              Role instructions and checks
            </button>
            {contract && <ContractDialog type={type} open onClose={() => setContract(false)} />}
          </>
        )}
      </Section>
      <Section title="Runtime">
        <button type="button" onClick={change.open} className="absolute top-3 right-4 cursor-pointer text-xs text-[#ff6b76] hover:underline">
          Change…
        </button>
        <div className="text-[12.5px] text-text-2">
          {c.config.runtime === 'demo'
            ? 'Demo (free)'
            : c.config.runtime === 'claude'
              ? `Claude · ${claude ? (claude.signedIn ? 'signed in' : 'not signed in') : 'checking…'}`
              : `Codex · ${codex ? (codex.reason ?? 'signed in') : 'checking…'}`}
        </div>
        {c.config.model && <div className="text-[12.5px] text-text-2">{[modelName(c.config.model), c.config.effort && `${EFFORT_LABEL[c.config.effort] ?? c.config.effort} effort`].filter(Boolean).join(' · ')}</div>}
        {c.config.runtime === 'codex' && codex?.version && (
          <p className="text-xs text-muted">
            Codex CLI {codex.version}
            {CODEX_TESTED.includes(codex.version) ? ', a version the app was tested with.' : `. The app was tested with ${CODEX_TESTED.join(', ')}; it checks this one's features before each use.`}
          </p>
        )}
        {first && runtimeLabel(first) !== runtimeLabel(c.config) && <p className="text-xs text-muted">Started on {runtimeLabel(first)}: the history stays here, and the new session started from a summary.</p>}
      </Section>
      <Section title="Store scope">
        <div className="flex items-center gap-1.5 text-[12.5px] text-text-2">
          <Lock aria-hidden className="size-3.5 text-muted" />
          {store.name} only
        </div>
        <p className="text-xs text-muted">
          {compares
            ? "Also reads your other stores' names, platforms and niches and their totals (revenue, profit, margin, ad spend, ROAS, orders, health and revenue change) for comparison. Turned on when this conversation started."
            : "Fixed when the conversation started. Other stores' data is never read."}
        </p>
      </Section>
      <Section title="Tools">
        {!tools ? (
          <p className="text-xs text-muted">Loading…</p>
        ) : (
          <ul className="grid gap-1.5">
            {tools.map((g) => {
              // As the board draws it: a check on what the agent can use, a cross and muted text on what it can't.
              const off = !!g.integration && (!g.integration.connected || (!g.tools.length && c.config.runtime === 'codex'));
              return (
                <li key={g.id} className={cx('flex items-center gap-2 text-[12.5px]', off ? 'text-muted' : 'text-text-2')}>
                  {off ? <X aria-hidden className="size-3.5 shrink-0" /> : <Check aria-hidden className="size-3.5 shrink-0 text-good" />}
                  <span className="min-w-0 flex-1">{g.name}</span>
                  <span className="text-right text-xs text-muted">
                    {g.integration && !g.tools.length && c.config.runtime === 'codex' ? (
                      'Claude only for now'
                    ) : g.integration && !g.integration.connected ? (
                      <>
                        Not connected ·{' '}
                        <Link to="/integrations" className="text-[#ff6b76] hover:underline">
                          Set up
                        </Link>
                      </>
                    ) : rules.length && g.tools.includes('propose_ad_change') ? (
                      'Autopilot up to the caps below'
                    ) : (
                      ACCESS[g.access]
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Approvals and budget">
        <ul className="grid gap-1 text-[12.5px] text-text-2">
          {approvalLines(rules).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {latest && latest.status !== 'queued' && (
          <div className="mt-1.5 grid gap-1.5">
            {budgetUsd && latest.runtime !== 'codex' && <ProgressBar label="This run's spend" value={latest.usage.costUsd / budgetUsd} tone="muted" />}
            <span className="text-xs text-muted">{spendLabel(latest, budgetUsd)}</span>
          </div>
        )}
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Run budget</dt>
          <dd className="text-right text-text-2">{budgetUsd ? cents(budgetUsd) : 'No limit'}</dd>
          <dt className="text-muted">Stop after</dt>
          <dd className="text-right text-text-2">{stopAfterMin ? `${stopAfterMin} min` : 'No limit'}</dd>
        </dl>
      </Section>
      {latest && (
        <p className="px-4 py-3 text-[11px] text-muted">
          Run {latest.id.slice(0, 8)} · started {new Date(latest.startedAt ?? latest.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
          {isLive(latest) || latest.error === INTERRUPTED ? 'can be continued after a restart' : 'ended'}
        </p>
      )}
    </>
  );
}

/** Every run of the conversation, newest first: status, runtime and model, duration, cost (tokens for Codex), and errors. */
function ActivityTab({ store, c }: { store: Store; c: ConversationDetail }) {
  const runs = runsOf(useThread(store.id, c.id).data?.pages).reverse();
  if (!runs.length) return <p className="px-4 py-3.5 text-[12.5px] text-muted">No runs yet.</p>;
  return (
    <ol className="divide-y divide-[#1d1d22]">
      {runs.map((r) => {
        const state = r.state ?? (r.status === 'done' ? 'completed' : r.status === 'error' ? 'failed' : r.status);
        return (
          <li key={r.id} className="grid gap-1 px-4 py-3 text-[12.5px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className={cx('font-medium', RUN_STATUS[state].tone === 'red' ? 'text-[#ff5a66]' : 'text-text')}>{RUN_STATUS[state].label}</span>
              <span className="text-xs text-muted">{r.endedAt && r.startedAt ? took(Date.parse(r.endedAt) - Date.parse(r.startedAt)) : isLive(r) ? 'running' : ''}</span>
            </div>
            <div className="truncate text-xs text-text-2" title={r.task}>
              {r.task}
            </div>
            <div className="text-xs text-muted">{[runtimeLabel(r), r.status !== 'queued' && (r.runtime === 'codex' ? `${(r.usage.inputTokens + r.usage.outputTokens).toLocaleString()} tokens` : cents(r.usage.costUsd))].filter(Boolean).join(' · ')}</div>
            {r.error && r.error !== INTERRUPTED && (
              <p className="flex flex-wrap gap-2 text-xs text-[#ff5a66]">
                {r.error}
                <FixLink message={r.error} agentId={r.agentId} />
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const HOW = { prompt: 'In its prompt', search: 'Searched for', cited: 'Cited' } as const;

/**
 * The cards the latest reply had in its prompt, searched for or cited: this store's, then General's (never another
 * store's). Then the findings this conversation saved.
 */
function KnowledgeTab({ store, c }: { store: Store; c: ConversationDetail }) {
  const k = useConversationKnowledge(store.id, c.id).data ?? [];
  const saved = useConversationFindings(store.id, c.id).data ?? [];
  const href = (id: string) => `/knowledge?card=${encodeURIComponent(id)}&ws=${encodeURIComponent(store.id)}`;
  const findings = saved.length > 0 && (
    <Section key="saved" title="Saved from this conversation">
      <ul className="grid gap-2">
        {saved.map((f) => (
          <li key={f.id} className="grid gap-0.5 text-[12.5px]">
            <Link to={href(f.id)} className="text-text hover:text-white hover:underline">
              {f.title}
            </Link>
            <span className="text-xs text-muted">{STATUS[f.status]}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
  if (!c.config.knowledge.length) return [<p key="none" className="px-4 py-3.5 text-[12.5px] text-muted">This agent reads no knowledge: its settings leave out the store's and General.</p>, findings];
  if (!k.length) return [<p key="none" className="px-4 py-3.5 text-[12.5px] text-muted">No cards yet. The cards a reply has in its prompt, searches for or cites show here.</p>, findings];
  const groups = [
    [`${store.name}'s knowledge`, k.filter((x) => x.storeId !== null)],
    ['General knowledge', k.filter((x) => x.storeId === null)],
  ] as const;
  return [
    ...groups.map(
    ([title, list]) =>
      list.length > 0 && (
        <Section key={title} title={title}>
          <ul className="grid gap-2">
            {list.map((card) => (
              <li key={card.id} className="grid gap-0.5 text-[12.5px]">
                <Link to={href(card.id)} className="text-text hover:text-white hover:underline">
                  {card.title}
                </Link>
                <span className="text-xs text-muted">
                  {card.stage === 'hypothesis' ? 'Hypothesis, unproven' : KB_STAGES[card.stage]} · {card.how.map((h) => HOW[h]).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ),
    ),
    findings,
  ];
}
