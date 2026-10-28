// UI-03 data layer: typed fetchers + react-query hooks over the local API, and the /api/live socket.
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActionLogEntry,
  KnowledgeUse,
  SendMessageInput,
  Agent,
  AgentRun,
  AgentRunDetail,
  AgentPreset,
  AgentTypeInfo,
  Conversation,
  ConversationCounts,
  ConversationContext,
  ConversationDetail,
  CreateCustomRoleInput,
  CustomRole,
  ToolGroup,
  RuntimeCapabilities,
  RuntimeId,
  ConversationPage,
  CreateConversationInput,
  CursorPage,
  AgentUpdate,
  AnalyticsRange,
  AnalyticsSummary,
  AppNotification,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  AutomationRule,
  AutomationRuleInput,
  AutomationRun,
  Backup,
  CampaignStats,
  ClaudeAccount,
  Competitor,
  CompetitorInput,
  CompetitorSnapshot,
  Creative,
  CreativeKind,
  FlowDraft,
  FulfillmentStatus,
  Health,
  Integration,
  IntegrationInput,
  IntegrationKind,
  KbAskAnswer,
  KbCampaign,
  KbControls,
  KbControlsState,
  KbCard,
  KbCardBrief,
  KbCategory,
  KbCardInput,
  KbCategoryCount,
  KbEvidence,
  KbExperiment,
  KbLink,
  KbLinkInput,
  KbOverview,
  NewKbExperiment,
  KbPromotion,
  KbRevision,
  KbPositions,
  KbSourceResearchInput,
  KbTaskBrief,
  KbTaskDetail,
  KbView,
  KbViewState,
  KbSourceBrief,
  KbCardPatch,
  KbWorkspaceCounts,
  KnowledgeDoc,
  KnowledgeKind,
  LiveMessage,
  MemoryInput,
  NicheLearning,
  OAuthStart,
  Order,
  OrderIssue,
  OrderIssueStatus,
  OrderStatus,
  Page,
  PageDraft,
  PriceChange,
  Product,
  ProductList,
  ResearchProduct,
  ResearchTab,
  Settings,
  SettingsUpdate,
  Store,
  StoreCaps,
  StoreCapsUpdate,
  StoreEvent,
  StoreInput,
  StoreUsage,
  StoreMemory,
  SupplierProduct,
  TopProduct,
} from '@frontline/shared';
import { useNavigate } from 'react-router';
import { agentsUrl } from '../agents/urls';
import { apiUp, waitForApi } from '../lib/restart';
import { importing } from '../lib/sync';
import { applyRunEvent, isLive } from '../lib/transcript';
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // fetch rejects only when nothing answered: say that, not the browser's "Failed to fetch" (mutations show the message).
  const r = await fetch(path, init).catch(() => {
    throw new Error("Couldn't reach the app's server: it may be restarting. Try again in a moment.");
  });
  if (r.status === 204) return undefined as T;
  if (!r.ok) {
    // A form's refusal names its field (validateConfig, validateCustomRole): the form shows it there.
    const body = (await r.json().catch(() => null)) as { error?: string; field?: string } | null;
    throw Object.assign(new Error(body?.error ?? `The app's server couldn't do that (error ${r.status}). Try again in a moment.`), body?.field ? { field: body.field } : {});
  }
  return (await r.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
export const useStores = () => useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/api/stores') });

/** Opens the data folder (logs, backups) in Explorer on this computer. */
/** In the desktop app its main process opens Explorer (in front of the window; '' or Windows' error back); else the API does. */
export const useOpenDataFolder = () =>
  useMutation({
    mutationFn: async () => {
      if (!window.desktop) return api<void>('/api/settings/open-data-folder', { method: 'POST' });
      const error = await window.desktop.openDataFolder();
      if (error) throw new Error(error);
    },
  });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (u: SettingsUpdate) => api<Settings>('/api/settings', json('PATCH', u)),
    onSuccess: (st, u) => {
      qc.setQueryData(['settings'], st);
      // Multi-store totals are converted to the base currency.
      if (u.baseCurrency) ['summary', 'campaigns', 'top-products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function useStoreActions() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: ({ id, ...st }: StoreInput & { id?: string }) => api<Store>(id ? `/api/stores/${id}` : '/api/stores', json(id ? 'PATCH' : 'POST', st)),
      onSuccess: () => ['stores', 'agents'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    }),
    // A store shows up in nearly every query, so drop them all.
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/api/stores/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries() }),
  };
}

/** Empty `storeIds` = all stores. Keeps the previous range on screen while the next one loads. */
export const useSummary = (storeIds: string[], range: AnalyticsRange) =>
  useQuery({
    queryKey: ['summary', storeIds, range],
    queryFn: () => api<AnalyticsSummary>(`/api/analytics/summary?stores=${storeIds.join(',')}&range=${range}`),
    placeholderData: keepPreviousData,
  });

// ponytail: the lists below fetch every store once and filter client-side; pass `stores=` when there are dozens of stores.
export const useEvents = (storeIds: string[]) =>
  useQuery({ queryKey: ['events', storeIds], queryFn: () => api<StoreEvent[]>(`/api/events?stores=${storeIds.join(',')}&limit=30`) });
export const useApprovals = (status: ApprovalStatus = 'pending') =>
  useQuery({ queryKey: ['approvals', status], queryFn: () => api<ApprovalRequest[]>(`/api/approvals?status=${status}`) });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/api/agents') });

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    // A deny can carry the owner's reason; the denial memory keeps it.
    mutationFn: ({ id, verdict, note }: { id: string; verdict: ApprovalDecision; note?: string }) =>
      api<ApprovalRequest>(`/api/approvals/${id}/${verdict}`, note ? json('POST', { note }) : { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AgentUpdate & { id: string }) => api<Agent>(`/api/agents/${encodeURIComponent(id)}`, json('PATCH', body)),
    onSuccess: (a) => qc.setQueryData<Agent[]>(['agents'], (old = []) => old.map((o) => (o.id === a.id ? a : o))),
  });
}

export const useRuns = (agentId: string) => useQuery({ queryKey: ['runs', agentId], queryFn: () => api<AgentRun[]>(`/api/runs?agent=${encodeURIComponent(agentId)}&limit=50`) });
// Live events stream into this cache; the poll only covers a run that finished before its POST response landed.
export const useRun = (id: string) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => api<AgentRunDetail>(`/api/runs/${id}`),
    staleTime: Infinity,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isLive(q.state.data) ? 2000 : false),
  });

// Conversations (AA-05). Every call names its store: the server answers 404 for another store's record (decision 13).
// A clientRequestId is made when the dialog or composer opens (or per Retry/Resume click) and kept until the server
// answers, so a repeated send returns what the first one started.

export interface ConversationFilter {
  view?: 'active' | 'archived' | 'pinned';
  /** A role, a custom role id, or 'team'. */
  type?: string;
  /** Days of activity to show (running ones always show). */
  range?: number;
  q?: string;
}

const conversationsUrl = (storeId: string, f: ConversationFilter, cursor?: string) =>
  `/api/conversations?${new URLSearchParams({
    store: storeId,
    ...(f.view ? { view: f.view } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.range ? { range: String(f.range) } : {}),
    ...(f.q?.trim() ? { q: f.q.trim() } : {}),
    ...(cursor ? { cursor } : {}),
  })}`;

/** A store's conversations, last activity first, 50 a page (fetchNextPage loads older ones). */
export const useConversations = (storeId: string, filter: ConversationFilter = {}) =>
  useInfiniteQuery({
    queryKey: ['conversations', storeId, filter],
    queryFn: ({ pageParam }) => api<ConversationPage>(conversationsUrl(storeId, filter, pageParam || undefined)),
    initialPageParam: '',
    getNextPageParam: (last) => last.next,
    enabled: !!storeId,
    // Typing in search keeps the last results up until the new ones land.
    placeholderData: keepPreviousData,
  });

/** Per store, conversations going and waiting on the owner: the store switcher's counts. */
export const useConversationCounts = () => useQuery({ queryKey: ['conversation-counts'], queryFn: () => api<ConversationCounts>('/api/conversations/counts') });

/** The agent types a store can talk to, in list order. */
/** The conversation's tools by access, with each group's integration state (the Details panel). */
/** The Knowledge tab: the cards the latest reply had in its prompt, searched for or cited (refetched with the conversation). */
export const useConversationKnowledge = (storeId: string, id: string) =>
  useQuery({ queryKey: ['conversation', id, 'knowledge'], queryFn: () => api<KnowledgeUse[]>(`/api/conversations/${id}/knowledge?store=${storeId}`), enabled: !!id });

export const useConversationTools = (storeId: string, id: string) =>
  useQuery({ queryKey: ['conversation-tools', id], queryFn: () => api<ToolGroup[]>(`/api/conversations/${id}/tools?store=${storeId}`), enabled: !!id });

export const useAgentTypes = (storeId: string) => useQuery({ queryKey: ['agent-types', storeId], queryFn: () => api<AgentTypeInfo[]>(`/api/agent-types?store=${storeId}`), enabled: !!storeId });

/** What each runtime can run here (decision 9): checked without a model turn, kept 5 minutes by the server too. */
export const useRuntimes = () => useQuery({ queryKey: ['runtimes'], queryFn: () => api<RuntimeCapabilities[]>('/api/runtimes'), staleTime: 5 * 60_000 });
/** "Check again": the runtimes checked now rather than from the server's 5-minute cache. */
export function useRefreshRuntimes() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<RuntimeCapabilities[]>('/api/runtimes?refresh=1'), onSuccess: (r) => qc.setQueryData(['runtimes'], r) });
}
/** "Set up Codex": the server starts `codex login` on the app's own Codex folder; the owner signs in in the browser it opens. */
export const useSetUpCodex = () => useMutation({ mutationFn: () => api<{ started: boolean }>('/api/runtimes/codex/setup', json('POST', {})) });

/** A type's tools for Deploy, with each group's integration state. */
export const useTypeTools = (storeId: string, type: string) =>
  useQuery({ queryKey: ['tool-groups', storeId, type], queryFn: () => api<ToolGroup[]>(`/api/tool-groups?store=${storeId}&type=${encodeURIComponent(type)}`), enabled: !!storeId && !!type });

/** A type's presets: its built-in Default first, then the owner's saved ones. */
export const usePresets = (storeId: string, type: string) =>
  useQuery({ queryKey: ['presets', storeId, type], queryFn: () => api<AgentPreset[]>(`/api/presets?store=${storeId}&type=${encodeURIComponent(type)}`), enabled: !!storeId && !!type });

export function useSavePreset(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; type: string; config: object; objective?: string; allStores?: boolean }) => api<AgentPreset>(`/api/presets?store=${storeId}`, json('POST', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  });
}

/** "Change runtime or model…" (decision 10): a new config; the next turn starts a new session from a recap. */
export function useChangeConfig(storeId: string, conversationId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: (input: { runtime: RuntimeId; model?: string; effort?: string; stopAfterMin?: number }) => api<ConversationDetail>(`/api/conversations/${conversationId}/config?store=${storeId}`, json('POST', input)),
    onSuccess: () => done(conversationId),
  });
}

/** Makes a custom role (decision 2). Every store's types refresh: it may be for all of them. */
export function useCreateCustomRole(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomRoleInput) => api<CustomRole>(`/api/custom-roles?store=${storeId}`, json('POST', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-types'] }),
  });
}

/** A 404 (deleted, or another store's) shows at once instead of after three retries. */
export const useConversation = (storeId: string, id: string) =>
  useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api<ConversationDetail>(`/api/conversations/${id}?store=${storeId}`),
    enabled: !!storeId && !!id,
    retry: (n, e) => n < 3 && !/not found$/.test(e.message),
  });

/** A conversation's runs, oldest first; fetchNextPage loads the page before the oldest shown. Seeds each ['run', id]. */
export function useThread(storeId: string, id: string) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: ['thread', id],
    queryFn: async ({ pageParam }) => {
      const page = await api<CursorPage<AgentRunDetail>>(`/api/conversations/${id}/thread?store=${storeId}${pageParam ? `&before=${pageParam}` : ''}`);
      for (const run of page.items) qc.setQueryData<AgentRunDetail>(['run', run.id], (old) => old ?? run);
      return page;
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next,
    enabled: !!storeId && !!id,
  });
}

/** After any change to a conversation: its row, its thread and the store's lists. */
function useConversationDone(storeId: string) {
  const qc = useQueryClient();
  return (conversationId: string, run?: AgentRunDetail | AgentRun) => {
    if (run) qc.setQueryData<AgentRunDetail>(['run', run.id], (old) => old ?? { ...run, transcript: [] });
    for (const key of [['conversations', storeId], ['conversation', conversationId], ['thread', conversationId]]) qc.invalidateQueries({ queryKey: key });
  };
}

/**
 * Deploy, startConversation and Continue in a new conversation: opens a conversation and starts its first turn. A
 * module passes `type`, `message` (the objective) and its `context` reference.
 */
export function useCreateConversation(storeId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: (input: CreateConversationInput) => api<{ conversation: Conversation; run: AgentRun }>(`/api/conversations?store=${storeId}`, json('POST', input)),
    onSuccess: (r) => done(r.conversation.id, r.run),
  });
}

/**
 * startConversation (decision 14): a module opens a conversation about one of the store's records (the server refuses
 * another store's) with the objective as its first message, and the workspace opens on it.
 */
export function useStartConversation(storeId: string) {
  const create = useCreateConversation(storeId);
  const navigate = useNavigate();
  const start = ({ objective, ...input }: { type: string; title?: string; objective: string; context?: ConversationContext }) =>
    create.mutate({ clientRequestId: crypto.randomUUID(), message: objective, ...input }, { onSuccess: (r) => navigate(agentsUrl({ store: storeId, conversation: r.conversation.id })) });
  return { start, isPending: create.isPending, error: create.error };
}

/** Sends a message; while a reply is going it waits in the queue behind it. */
export function useSendMessage(storeId: string, conversationId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: (input: SendMessageInput) => api<AgentRun>(`/api/conversations/${conversationId}/messages?store=${storeId}`, json('POST', input)),
    onSuccess: (run) => done(conversationId, run),
  });
}

/** Answers an agent's question (ask_owner) from its conversation's composer; the run goes on with the text. */
export function useAnswer(storeId: string, conversationId: string) {
  const qc = useQueryClient();
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api<ApprovalRequest>(`/api/approvals/${id}/answer?store=${storeId}`, json('POST', { text })),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['approvals'] }), done(conversationId)),
  });
}

/** Retry (a failed or unsatisfying reply, from the last one that finished) or Resume (one cut off by a restart). */
export function useRetryRun(storeId: string, conversationId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: ({ runId, resume, clientRequestId }: { runId: string; resume?: boolean; clientRequestId: string }) =>
      api<AgentRun>(`/api/conversations/${conversationId}/runs/${runId}/${resume ? 'resume' : 'retry'}?store=${storeId}`, json('POST', { clientRequestId })),
    onSuccess: (run) => done(conversationId, run),
  });
}

/** Stops the reply that is going, or takes back a queued message (`runId`). */
export function useStopConversation(storeId: string, conversationId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: (runId?: string) => api<AgentRun>(`/api/conversations/${conversationId}/stop?store=${storeId}`, json('POST', runId ? { runId } : {})),
    onSuccess: () => done(conversationId),
  });
}

/** Rename, pin, archive or unarchive. */
export function useUpdateConversation(storeId: string) {
  const done = useConversationDone(storeId);
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; pinned?: boolean; archived?: boolean }) => api<Conversation>(`/api/conversations/${id}?store=${storeId}`, json('PATCH', patch)),
    onSuccess: (c) => done(c.id),
  });
}

/** Starts a run (or a chat follow-up with `resumeRunId`); the live socket streams the rest into ['run', id]. */
export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, task, resumeRunId }: { agentId: string; task: string; resumeRunId?: string }) =>
      api<AgentRunDetail>(`/api/agents/${encodeURIComponent(agentId)}/runs`, json('POST', { task, resumeRunId })),
    onSuccess: (r) => {
      qc.setQueryData<AgentRunDetail>(['run', r.id], (old) => old ?? r);
      qc.invalidateQueries({ queryKey: ['runs', r.agentId] });
    },
  });
}

/** Asks the knowledge base (KB-24): the matching cards and, with any, the Market Analyst's run that answers from them. */
export function useAskKb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { ws: string; question: string; payerId?: string }) => api<KbAskAnswer>('/api/kb/ask', json('POST', b)),
    onSuccess: (a) => a.run && qc.invalidateQueries({ queryKey: ['runs', a.run.agentId] }),
  });
}

/** Asks a custom niche's Market Analyst to draft the niche's pack (agents' AGT-231); saving it is an approval. */
export function useDraftNichePack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api<AgentRun>(`/api/agents/${encodeURIComponent(agentId)}/niche-pack`, { method: 'POST' }),
    onSuccess: (r) => qc.invalidateQueries({ queryKey: ['runs', r.agentId] }),
  });
}

export const useCancelRun = () => useMutation({ mutationFn: (id: string) => api<AgentRun>(`/api/runs/${id}/cancel`, { method: 'POST' }) });

export const useMemory = (storeId: string) => useQuery({ queryKey: ['memory', storeId], queryFn: () => api<StoreMemory[]>(`/api/stores/${storeId}/memory`), enabled: !!storeId });

export function useAddMemory(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: MemoryInput) => api<StoreMemory>(`/api/stores/${storeId}/memory`, json('POST', m)),
    onSuccess: (m) => qc.setQueryData<StoreMemory[]>(['memory', storeId], (old = []) => [m, ...old]),
  });
}

export function useForgetMemory(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/memory/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => qc.setQueryData<StoreMemory[]>(['memory', storeId], (old = []) => old.filter((m) => m.id !== id)),
  });
}

/** Memory of several stores at once; shares the per-store cache with useMemory. */
export const useMemories = (storeIds: string[]) =>
  useQueries({
    queries: storeIds.map((id) => ({ queryKey: ['memory', id], queryFn: () => api<StoreMemory[]>(`/api/stores/${id}/memory`) })),
    combine: (rs) => ({
      data: rs.every((r) => r.data) ? rs.flatMap((r) => r.data ?? []) : undefined,
      isPending: rs.some((r) => r.isPending),
      isError: rs.some((r) => r.isError),
      refetch: () => rs.forEach((r) => r.refetch()),
    }),
  });

/** Edit or pin a memory (pinned ones go into every run's prompt for that store). */
export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; text?: string; pinned?: boolean }) => api<StoreMemory>(`/api/memory/${id}`, json('PATCH', patch)),
    onSuccess: (m) => qc.setQueryData<StoreMemory[]>(['memory', m.storeId], (old = []) => old.map((x) => (x.id === m.id ? m : x))),
  });
}

export const useKnowledge = () => useQuery({ queryKey: ['knowledge'], queryFn: () => api<KnowledgeDoc[]>('/api/knowledge') });
export const useKnowledgeDoc = (kind: KnowledgeKind, key: string) =>
  useQuery({ queryKey: ['knowledge', kind, key], queryFn: () => api<KnowledgeDoc>(`/api/knowledge/${kind}/${encodeURIComponent(key)}`), enabled: !!key });

/** Visible cards per knowledge workspace ('general' or a store id). */
export const useKbWorkspaces = () => useQuery({ queryKey: ['kb', 'workspaces'], queryFn: () => api<KbWorkspaceCounts>('/api/kb/workspaces') });

/** A workspace's cards ('general' or a store id; `general` adds General's to a store's). */
/** `q` holds KbCardQuery params: true is sent as 1; false, '' and undefined are left out. */
export const useKbCards = (ws: string, q: Record<string, string | number | boolean | undefined>) =>
  useQuery({
    queryKey: ['kb', 'cards', ws, q],
    queryFn: () => api<Page<KbCardBrief>>(`/api/kb/cards?${new URLSearchParams([['ws', ws], ...Object.entries(q).flatMap(([k, v]) => (v === undefined || v === false || v === '' ? [] : [[k, v === true ? '1' : String(v)]]))])}`),
    placeholderData: keepPreviousData,
  });

export const useKbSources = (ws: string, general: boolean) => useQuery({ queryKey: ['kb', 'sources', ws, general], queryFn: () => api<KbSourceBrief[]>(`/api/kb/sources?${wsq(ws)}${general ? '&general=1' : ''}`) });

/** One change to many cards, sent per workspace: each card's write goes to its own. */
export function useKbBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cards, patch }: { cards: KbCardBrief[]; patch: Pick<KbCardPatch, 'status' | 'blockedRoles' | 'researchMarked' | 'category'> }) => {
      const by = new Map<string, string[]>();
      for (const c of cards) by.set(c.storeId ?? 'general', [...(by.get(c.storeId ?? 'general') ?? []), c.id]);
      return Promise.all([...by].map(([ws, ids]) => api<{ updated: number }>('/api/kb/cards/bulk', json('POST', { ws, ids, patch }))));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** Where the owner dragged cards on a workspace's artboard. */
export const useKbPositions = (ws: string) => useQuery({ queryKey: ['kb', 'positions', ws], queryFn: () => api<KbPositions>(`/api/kb/positions?ws=${encodeURIComponent(ws)}`) });

/** Saves dragged cards' places: they move at once, and go back if the save fails. */
export function useSaveKbPositions(ws: string) {
  const qc = useQueryClient();
  const key = ['kb', 'positions', ws];
  return useMutation({
    mutationFn: (p: KbPositions) => api<void>(`/api/kb/positions?ws=${encodeURIComponent(ws)}`, json('PUT', p)),
    onMutate: (p) => {
      const old = qc.getQueryData<KbPositions>(key);
      qc.setQueryData<KbPositions>(key, { ...old, ...p });
      return old;
    },
    onError: (_e, _p, old) => qc.setQueryData(key, old),
  });
}

/** One card from any workspace (a `?card=` link). */
/** A card: any workspace's (the Knowledge page), or a store's and General's only (a reply's citation, decision 11: a 404 there is final). */
export const kbCardQuery = (id: string, ws = 'all') => ({
  queryKey: ['kb', 'card', id, ws],
  queryFn: () => api<KbCard>(`/api/kb/cards/${encodeURIComponent(id)}?ws=${encodeURIComponent(ws)}${ws === 'all' ? '' : '&general=1'}`),
  ...(ws === 'all' ? {} : { retry: false, retryOnMount: false }),
});
export const useKbCard = (id: string | undefined, ws = 'all') => useQuery({ ...kbCardQuery(id ?? '', ws), enabled: !!id });
export const useKbCardsIn = (ids: string[], ws: string) => useQueries({ queries: ids.map((id) => kbCardQuery(id, ws)) });

const wsq = (ws: string) => `ws=${encodeURIComponent(ws)}`;

/** A workspace's links (rejected ones left out); `general` adds the General cards' own. */
export const useKbLinks = (ws: string, general: boolean) => useQuery({ queryKey: ['kb', 'links', ws, general], queryFn: () => api<KbLink[]>(`/api/kb/links?${wsq(ws)}${general ? '&general=1' : ''}`) });

/** Accept or reject a link, in the link's own workspace. */
export function useDecideKbLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ link, status }: { link: Pick<KbLink, 'id' | 'storeId'>; status: 'confirmed' | 'rejected' }) => api<KbLink>(`/api/kb/links/${encodeURIComponent(link.id)}?${wsq(link.storeId ?? 'general')}`, json('PATCH', { status })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** The owner's own link between two cards; `ws` is the store when either card is a store's. */
export function useCreateKbLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: KbLinkInput & { ws: string }) => api<KbLink>('/api/kb/links', json('POST', b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

const cardUrl = (c: { id: string; storeId: string | null }, path = '') => `/api/kb/cards/${encodeURIComponent(c.id)}${path}?${wsq(c.storeId ?? 'general')}`;
/** A card's evidence (oldest first), read in the card's own workspace. */
export const useKbEvidence = (c: { id: string; storeId: string | null } | undefined) => useQuery({ queryKey: ['kb', 'evidence', c?.id], queryFn: () => api<KbEvidence[]>(cardUrl(c!, '/evidence')), enabled: !!c });
/** A card's tests (KB-21), newest first. */
export const useKbExperiments = (c: { id: string; storeId: string | null } | undefined) => useQuery({ queryKey: ['kb', 'experiments', c?.id], queryFn: () => api<KbExperiment[]>(cardUrl(c!, '/experiments')), enabled: !!c });
/** A store's (or every store's) campaigns: the Library's Campaigns section, and what a test can compare. */
export const useKbCampaigns = (ws: string | undefined) => useQuery({ queryKey: ['kb', 'campaigns', ws], queryFn: () => api<KbCampaign[]>(`/api/kb/campaigns?${wsq(ws!)}`), enabled: !!ws });

/** A workspace's research controls (KB-22), with what self-directed research reserved in the last 24 hours. */
export const useKbControls = (ws: string | undefined) => useQuery({ queryKey: ['kb', 'controls', ws], queryFn: () => api<KbControlsState>(`/api/kb/controls?${wsq(ws!)}`), enabled: !!ws });
export function useSaveKbControls() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ws, ...c }: Partial<KbControls> & { ws: string }) => api<KbControlsState>(`/api/kb/controls?${wsq(ws)}`, json('PUT', c)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** Plans a test of a card (`plan`), or cancels a planned one (`cancel`: its id). */
export function useKbTestWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ card, plan, cancel }: { card: { id: string; storeId: string | null }; plan?: NewKbExperiment; cancel?: string }): Promise<unknown> =>
      cancel ? api<void>(`/api/kb/experiments/${encodeURIComponent(cancel)}?${wsq(card.storeId ?? 'general')}`, { method: 'DELETE' }) : api<KbExperiment>(cardUrl(card, '/experiments'), json('POST', plan)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}
/** A card's revisions, newest first. */
export const useKbRevisions = (c: { id: string; storeId: string | null } | undefined) => useQuery({ queryKey: ['kb', 'revisions', c?.id], queryFn: () => api<KbRevision[]>(cardUrl(c!, '/revisions')), enabled: !!c });

/** The owner's writes on a card, in its own workspace: no `path` patches it; '/merge', '/detach' and '/revisions/<id>/restore' post. */
export function useKbCardWrite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ card, path, body }: { card: { id: string; storeId: string | null }; path?: string; body?: unknown }) => api<KbCard>(cardUrl(card, path), json(path ? 'POST' : 'PATCH', body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** A card the owner writes by hand (active, User-Provided unless a type is given). */
export function useCreateKbCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<KbCardInput> & { ws: string; title: string }) => api<KbCard>('/api/kb/cards', json('POST', b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** A workspace's category tree in outline order, each with its own card count. */
export const useKbCategories = (ws: string) => useQuery({ queryKey: ['kb', 'categories', ws], queryFn: () => api<KbCategoryCount[]>(`/api/kb/categories?${wsq(ws)}`) });

export function useCreateKbCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { ws: string; name: string; parentId?: string }) => api<KbCategory>('/api/kb/categories', json('POST', b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'categories'] }),
  });
}

/** Saved artboard views of a workspace. */
export const useKbViews = (ws: string) => useQuery({ queryKey: ['kb', 'views', ws], queryFn: () => api<KbView[]>(`/api/kb/views?${wsq(ws)}`) });

export function useSaveKbView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { ws: string; name: string; state: KbViewState }) => api<KbView>('/api/kb/views', json('POST', b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'views'] }),
  });
}

export function useDeleteKbView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: KbView) => api<void>(`/api/kb/views/${encodeURIComponent(v.id)}?${wsq(v.storeId ?? 'general')}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'views'] }),
  });
}

/** Research tasks of a workspace ('all' for every one); `open` = queued or running. Research stages are runs, so run messages refresh it. */
export const useKbOverview = (ws: string) => useQuery({ queryKey: ['kb', 'overview', ws], queryFn: () => api<KbOverview>(`/api/kb/overview?${wsq(ws)}`) });

/** The owner keeps both sides of a conflict. */
export function useKeepBoth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ws }: { id: string; ws: string }) => api<void>(`/api/kb/conflicts/${encodeURIComponent(id)}?${wsq(ws)}`, json('PATCH', { status: 'kept_both' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** Asks an agent to draft the store card's General version (KB-18); the draft comes back as a 'kb.promote' approval. */
export const usePromoteKbCard = () =>
  useMutation({ mutationFn: (card: KbCard) => api<{ runId: string; agentId: string }>(`/api/kb/cards/${encodeURIComponent(card.id)}/promote?${wsq(card.storeId ?? 'general')}`, { method: 'POST' }) });

/** The owner's edit of a General draft, before approving it. */
export function useEditPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approval, draft }: { approval: ApprovalRequest; draft: Omit<KbPromotion, 'cardId'> }) =>
      api<ApprovalRequest>(`/api/kb/promotions/${encodeURIComponent(approval.id)}?${wsq(approval.storeId)}`, json('PATCH', draft)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  });
}

export const useKbTasks = (ws: string, open = false) => useQuery({ queryKey: ['kb', 'tasks', ws, open], queryFn: () => api<KbTaskBrief[]>(`/api/kb/research/tasks?${wsq(ws)}${open ? '&open=1' : ''}`) });

/** A task in full. Polled while it's going: a stage streams only when it ends, and the owner watches each source get read. */
export const useKbTask = (id: string | undefined) =>
  useQuery({
    queryKey: ['kb', 'task', id],
    queryFn: () => api<KbTaskDetail>(`/api/kb/research/tasks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === 'queued' || q.state.data?.status === 'running' ? 2000 : false),
  });

/** Research From Source: the owner's links, text or document, for an agent to read. */
export function useStartKbResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: KbSourceResearchInput) => api<KbTaskBrief>('/api/kb/research/tasks', json('POST', b)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'tasks'] }),
  });
}

/** Stop a task that's going, Retry a stopped or failed one from where it ended, or Refine a finished one as a new task. */
export function useKbTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body = {} }: { id: string; action: 'cancel' | 'retry' | 'refine'; body?: { objective?: string; budgetUsd?: number } }) =>
      api<KbTaskBrief>(`/api/kb/research/tasks/${encodeURIComponent(id)}/${action}`, json('POST', body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** Save the owner's version of a doc, or (markdown undefined) go back to the shipped one. */
export function useSaveKnowledge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, key, markdown }: { kind: KnowledgeKind; key: string; markdown?: string }) =>
      api<KnowledgeDoc>(`/api/knowledge/${kind}/${encodeURIComponent(key)}`, markdown === undefined ? { method: 'DELETE' } : json('PUT', { markdown })),
    onSuccess: (d) => {
      qc.setQueryData(['knowledge', d.kind, d.key], d);
      qc.invalidateQueries({ queryKey: ['knowledge'], exact: true });
    },
  });
}

export const useCaps = (storeId: string) => useQuery({ queryKey: ['caps', storeId], queryFn: () => api<StoreCaps[]>(`/api/caps?stores=${storeId}`).then((c) => c[0]) });

/** Today's use of each store's caps (AI $, generation credits, ad budget added). */
export const useUsage = (storeIds: string[]) => useQuery({ queryKey: ['usage', storeIds], queryFn: () => api<StoreUsage[]>(`/api/usage?stores=${storeIds.join(',')}`) });

export function useSaveCaps(storeId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (u: StoreCapsUpdate) => api<StoreCaps>(`/api/caps/${storeId}`, json('PUT', u)), onSuccess: (c) => qc.setQueryData(['caps', storeId], c) });
}

/** Up to 200 products for a research tab (none = best AI score first), filtered by niche and search. */
/** `real`: leave out the sample catalog (made-up numbers every install starts with). */
export const useResearch = (tab: ResearchTab | undefined, niche: string, q: string, real = false) =>
  useQuery({
    queryKey: ['research', tab, niche, q, real],
    queryFn: () => api<Page<ResearchProduct>>(`/api/research?${new URLSearchParams({ ...(tab && { tab }), ...(niche && { niche }), ...(q && { q }), ...(real && { sample: '0' }), limit: '200' })}`),
    placeholderData: keepPreviousData,
  });

export const useLists = () => useQuery({ queryKey: ['lists'], queryFn: () => api<ProductList[]>('/api/research/lists') });

export function useListActions() {
  const qc = useQueryClient();
  const put = (l: ProductList) => qc.setQueryData<ProductList[]>(['lists'], (old = []) => (old.some((o) => o.id === l.id) ? old.map((o) => (o.id === l.id ? l : o)) : [...old, l]));
  return {
    create: useMutation({ mutationFn: (name: string) => api<ProductList>('/api/research/lists', json('POST', { name })), onSuccess: put }),
    toggle: useMutation({
      mutationFn: ({ listId, productId, on }: { listId: string; productId: string; on: boolean }) =>
        api<ProductList>(`/api/research/lists/${listId}/items/${productId}`, { method: on ? 'PUT' : 'DELETE' }),
      onSuccess: put,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/api/research/lists/${id}`, { method: 'DELETE' }),
      onSuccess: (_, id) => qc.setQueryData<ProductList[]>(['lists'], (old = []) => old.filter((l) => l.id !== id)),
    }),
  };
}

/** Sends a product to the store's Product Hunter as an approval request. */
export function useAddToStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, storeId }: { productId: string; storeId: string }) => api<ApprovalRequest>(`/api/research/${productId}/add-to-store`, json('POST', { storeId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  });
}

/** The learnings shared with a niche: by store (custom niches keyed server-side) or by niche key (a niche pack's key). */
export const useNicheLearnings = (by: { store: string } | { niche: string }) =>
  useQuery({ queryKey: ['niche-learnings', by], queryFn: () => api<NicheLearning[]>(`/api/niche-learnings?${new URLSearchParams(by)}`) });

export function useForgetNicheLearning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/niche-learnings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['niche-learnings'] }),
  });
}

export const useCampaigns = (storeIds: string[], range: AnalyticsRange) =>
  useQuery({
    queryKey: ['campaigns', storeIds, range],
    queryFn: () => api<CampaignStats[]>(`/api/analytics/campaigns?stores=${storeIds.join(',')}&range=${range}`),
    placeholderData: keepPreviousData,
  });

export type OrderQuery = { q?: string; status?: OrderStatus; fulfillment?: FulfillmentStatus; sort?: 'createdAt' | 'total'; dir?: 'asc' | 'desc'; offset?: number; limit?: number };
export const useOrders = (storeIds: string[], o: OrderQuery) =>
  useQuery({
    queryKey: ['orders', storeIds, o],
    queryFn: () =>
      api<Page<Order>>(`/api/orders?stores=${storeIds.join(',')}&${new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (v === undefined || v === '' ? [] : [[k, String(v)]])))}`),
    placeholderData: keepPreviousData,
  });

// ponytail: polls so a sync result (connected → error) shows up; push it over the live socket if this ever gets chatty.
/** Connector status for the sidebar (sync failures surface here). */
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health'), refetchInterval: 60_000 });

/** The Claude Code login agents run on. Asking starts the CLI (~5 s, no usage), so the server keeps an answer 5 minutes. */
export function useClaudeAccount(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['claude-account'], queryFn: () => api<ClaudeAccount>('/api/claude-account'), staleTime: 5 * 60_000, enabled });
  const recheck = useMutation({ mutationFn: () => api<ClaudeAccount>('/api/claude-account?refresh=1'), onSuccess: (a) => qc.setQueryData(['claude-account'], a) });
  return { q, recheck };
}

export const useIntegrations = () => useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/api/integrations'), refetchInterval: 10_000 });

export function useIntegrationActions() {
  const qc = useQueryClient();
  const refresh = () => ['integrations', 'health'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  return {
    save: useMutation({ mutationFn: (i: IntegrationInput) => api<Integration>('/api/integrations', json('PUT', i)), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/api/integrations/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

/** Queues a sync now (202); the server's loop runs it within 30 s and the 10 s integrations poll shows the result. */
export const useSyncIntegration = () => useMutation({ mutationFn: (id: string) => api<unknown>(`/api/integrations/${id}/sync`, { method: 'POST' }) });

export const useOAuthKinds = () => useQuery({ queryKey: ['oauth-kinds'], queryFn: () => api<IntegrationKind[]>('/api/integrations/oauth'), staleTime: Infinity });

/** Connect button: start gets the provider URL to open; paste-style flows finish with the address the browser landed on. */
export function useOAuth() {
  const qc = useQueryClient();
  return {
    start: useMutation({ mutationFn: (i: IntegrationInput) => api<OAuthStart>('/api/integrations/oauth/start', json('POST', i)) }),
    finish: useMutation({
      mutationFn: (url: string) => api<Integration>('/api/integrations/oauth/finish', json('POST', { url })),
      onSuccess: () => ['integrations', 'health'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    }),
  };
}

export const useAutomations = () => useQuery({ queryKey: ['automations'], queryFn: () => api<AutomationRule[]>('/api/automations') });
export const useAutomationRuns = (storeIds: string[]) =>
  useQuery({ queryKey: ['automation-runs', storeIds], queryFn: () => api<AutomationRun[]>(`/api/automations/runs?stores=${storeIds.join(',')}&limit=50`) });

export function useAutomationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['automations'] });
  return {
    save: useMutation({
      mutationFn: ({ id, ...r }: AutomationRuleInput & { id?: string }) =>
        api<AutomationRule>(id ? `/api/automations/${id}` : '/api/automations', json(id ? 'PATCH' : 'POST', r)),
      onSuccess: refresh,
    }),
    toggle: useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api<AutomationRule>(`/api/automations/${id}`, json('PATCH', { enabled })), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/api/automations/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export const useSupplierSearch = (q: string) =>
  useQuery({ queryKey: ['suppliers', q], queryFn: () => api<SupplierProduct[]>(`/api/suppliers/products?${new URLSearchParams({ q, limit: '5' })}`), enabled: !!q });

export const useCompetitors = () => useQuery({ queryKey: ['competitors'], queryFn: () => api<Competitor[]>('/api/competitors') });
export const usePriceChanges = (storeIds: string[]) =>
  useQuery({ queryKey: ['price-changes', storeIds], queryFn: () => api<PriceChange[]>(`/api/competitors/price-changes?stores=${storeIds.join(',')}&limit=100`) });
export const useSnapshots = (competitorId: string, kind: CompetitorSnapshot['kind']) =>
  useQuery({ queryKey: ['snapshots', competitorId, kind], queryFn: () => api<CompetitorSnapshot[]>(`/api/competitors/${competitorId}/snapshots?kind=${kind}&limit=50`), enabled: !!competitorId });

export function useCompetitorActions() {
  const qc = useQueryClient();
  const refresh = () => ['competitors', 'price-changes'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  return {
    add: useMutation({ mutationFn: (c: CompetitorInput) => api<Competitor>('/api/competitors', json('POST', c)), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/api/competitors/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  };
}

export const useTopProducts = (storeIds: string[], range: AnalyticsRange, limit: number) =>
  useQuery({
    queryKey: ['top-products', storeIds, range, limit],
    queryFn: () => api<TopProduct[]>(`/api/analytics/top-products?stores=${storeIds.join(',')}&range=${range}&limit=${limit}`),
    placeholderData: keepPreviousData,
  });

/** The selected stores' products (first 200). */
export const useProducts = (storeIds: string[]) =>
  useQuery({ queryKey: ['products', storeIds], queryFn: () => api<Page<Product>>(`/api/products?stores=${storeIds.join(',')}&limit=200`) });

/**
 * Active products with no unit cost (their whole price counts as profit). Margin-first puts them on top (a cost of 0 is
 * a 100% margin), so one 200-product page finds them in any catalog. ponytail: past 200 missing costs, it shows 200.
 */
export const useMissingCosts = (storeIds: string[]) =>
  useQuery({
    queryKey: ['products', storeIds, 'missing-cost'],
    queryFn: () => api<Page<Product>>(`/api/products?stores=${storeIds.join(',')}&status=active&sort=margin&dir=desc&limit=200`),
    select: (page) => page.items.filter((p) => p.cost === 0),
  });

/** The owner's unit cost for a product the platform has none for; past orders are re-priced, so profit moves. */
export function useSetCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, id, cost }: { storeId: string; id: string; cost: number }) =>
      api<Product>(`/api/products/${encodeURIComponent(storeId)}/${encodeURIComponent(id)}`, json('PATCH', { cost })),
    onSuccess: () => ['products', 'summary', 'top-products', 'orders'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

/** Issues the Operations agent flagged, open first. */
export const useOrderIssues = (storeIds: string[]) =>
  useQuery({ queryKey: ['order-issues', storeIds], queryFn: () => api<OrderIssue[]>(`/api/order-issues?stores=${storeIds.join(',')}&limit=200`) });

export function useSetIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, resolution }: { id: string; status: OrderIssueStatus; resolution?: string }) =>
      api<OrderIssue>(`/api/order-issues/${id}`, json('PATCH', { status, ...(resolution && { resolution }) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['order-issues'] }),
  });
}

export const useCreatives = (kind?: CreativeKind) =>
  useQuery({ queryKey: ['creatives', kind], queryFn: () => api<Creative[]>(`/api/creatives?limit=60${kind ? `&kind=${kind}` : ''}`), placeholderData: keepPreviousData });

export function useDeleteCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/creatives/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creatives'] }),
  });
}

export const useFlowDrafts = (storeId: string) => useQuery({ queryKey: ['flow-drafts', storeId], queryFn: () => api<FlowDraft[]>(`/api/flow-drafts?stores=${storeId}`) });

/** `storeId`: the drawer's store; the server refuses a draft of another (decision 13). */
export function useDeleteFlowDraft(storeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/flow-drafts/${id}${storeId ? `?store=${storeId}` : ''}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flow-drafts'] }),
  });
}

export const usePageDrafts = (storeIds: string[]) =>
  useQuery({ queryKey: ['page-drafts', storeIds], queryFn: () => api<PageDraft[]>(`/api/page-drafts?stores=${storeIds.join(',')}`), placeholderData: keepPreviousData });

export function usePageDraftActions() {
  const qc = useQueryClient();
  const done = () => ['page-drafts', 'approvals', 'products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  return {
    publish: useMutation({ mutationFn: (id: string) => api<PageDraft>(`/api/page-drafts/${id}/publish`, { method: 'POST' }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api<void>(`/api/page-drafts/${id}`, { method: 'DELETE' }), onSuccess: done }),
  };
}

export const useBackups = () => useQuery({ queryKey: ['backups'], queryFn: () => api<Backup[]>('/api/backups') });

export function useBackupNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<Backup>('/api/backups', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['backups'] }) });
}

/** Restores a backup: the API backs up the current data, restarts on the snapshot, and the page reloads once it's back. */
export const useRestoreBackup = () =>
  useMutation({
    mutationFn: async (name: string) => {
      await api<{ restarting: true }>(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' });
      await waitForApi(apiUp);
      location.reload();
    },
  });

export const useActionLog = (storeIds: string[]) =>
  useQuery({ queryKey: ['actions', storeIds], queryFn: () => api<ActionLogEntry[]>(`/api/actions?stores=${storeIds.join(',')}&limit=50`) });

const BELL = 40;
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>(`/api/notifications?limit=${BELL}`) });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api<{ updated: number }>('/api/notifications/read', json('POST', ids ? { ids } : {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/** Mount once: streams /api/live into the react-query cache, reconnecting if the server restarts. */
/** Mount once (Shell). Returns false while the socket is down, so the UI can say it's reconnecting. */
/**
 * A store's first sync swaps its demo data for real (core switchToReal, agents' startFresh) without a live message of its
 * own: when an import finishes, refetch everything once. Mounted in the shell, so it rides the integrations poll.
 */
export function useGoLiveRefresh() {
  const qc = useQueryClient();
  const list = useIntegrations().data;
  const prev = useRef<Set<string>>(undefined);
  useEffect(() => {
    if (!list) return;
    const now = new Set(list.filter((i) => importing(i)).map((i) => i.id));
    if (prev.current && [...prev.current].some((id) => !now.has(id))) qc.invalidateQueries();
    prev.current = now;
  }, [list, qc]);
}

export function useLive() {
  const qc = useQueryClient();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry = 0;
    let closed = false;
    let dropped = false;
    const onMessage = (m: LiveMessage) => {
      if (m.type === 'event') {
        // Each feed is fetched for its picked stores ([] = all); an event only joins the feeds it belongs to.
        for (const [key, old] of qc.getQueriesData<StoreEvent[]>({ queryKey: ['events'] })) {
          const ids = key[1] as string[];
          if (old && (!ids.length || ids.includes(m.event.storeId))) qc.setQueryData(key, [m.event, ...old].slice(0, 30));
        }
        // An order event means a real order row and today's metrics moved.
        if (m.event.type === 'order') ['summary', 'orders', 'top-products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } else if (m.type === 'run_event') qc.setQueryData<AgentRunDetail>(['run', m.runId], (d) => d && applyRunEvent(d, m.event));
      else if (m.type === 'run') {
        // Finished: refetch the stored transcript, which also covers events that raced ahead of the POST response.
        if (isLive(m.run)) qc.setQueryData<AgentRunDetail>(['run', m.run.id], (d) => d && { ...d, ...m.run });
        else qc.invalidateQueries({ queryKey: ['run', m.run.id] });
        qc.invalidateQueries({ queryKey: ['runs', m.run.agentId] });
        if (m.run.conversationId) for (const key of [['conversations', m.run.storeId], ['conversation', m.run.conversationId], ['thread', m.run.conversationId]]) qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: ['kb', 'tasks'] });
        qc.invalidateQueries({ queryKey: ['agents'] });
        qc.invalidateQueries({ queryKey: ['memory', m.run.storeId] });
        qc.invalidateQueries({ queryKey: ['creatives'] });
        qc.invalidateQueries({ queryKey: ['order-issues'] });
        qc.invalidateQueries({ queryKey: ['flow-drafts'] });
        qc.invalidateQueries({ queryKey: ['page-drafts'] });
        // Product Hunter (AI Research, the daily scan) adds its finds to the research feed.
        if (!isLive(m.run)) qc.invalidateQueries({ queryKey: ['research'] });
        // A custom niche's Market Analyst saves its pack, once approved, before its run ends.
        if (!isLive(m.run)) qc.invalidateQueries({ queryKey: ['knowledge'] });
      } else if (m.type === 'kb_task') qc.invalidateQueries({ queryKey: ['kb'] }); // the task, the task lists, and the cards it filed
      if (m.type === 'approval' || m.type === 'run') {
        qc.invalidateQueries({ queryKey: ['conversation-counts'] });
        // Automation fires start runs or ask for approval; the log and "last fired" follow.
        ['automation-runs', 'automations'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        qc.invalidateQueries({ queryKey: ['usage'] });
      }
      if (m.type === 'notification') qc.setQueryData<AppNotification[]>(['notifications'], (old) => old && [m.notification, ...old].slice(0, BELL));
      if (m.type === 'approval') {
        qc.invalidateQueries({ queryKey: ['agents'] });
        // Approved requests change shared learnings, (ad changes) campaign budgets and statuses, or (price changes,
        // added products) the store's products.
        // Publish requests move Store Builder drafts between pending, approved, published and rejected.
        qc.invalidateQueries({ queryKey: ['page-drafts'] });
        // Approved changes to a live store or ad account are logged as they run.
        if (m.approval.status === 'approved') qc.invalidateQueries({ queryKey: ['actions'] });
        if (m.approval.status === 'approved') ['niche-learnings', 'campaigns', 'products'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        // A denial is written to the store's memory (with the owner's reason).
        if (m.approval.status === 'denied') qc.invalidateQueries({ queryKey: ['memory', m.approval.storeId] });
        // A decided request lingers ~1s so its "Approved"/"Denied" verdict shows before the row drops.
        setTimeout(() => qc.invalidateQueries({ queryKey: ['approvals'] }), m.approval.status === 'pending' ? 0 : 1000);
        // Knowledge requests (promotions, research an agent recommended) show in the Research Center, and approved ones
        // file a card or start a task a moment later.
        if (m.approval.action.kind.startsWith('kb.')) setTimeout(() => qc.invalidateQueries({ queryKey: ['kb'] }), m.approval.status === 'pending' ? 0 : 1000);
      }
    };
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      // Back after a drop (API restart, laptop sleep): refetch whatever changed while nothing was listening.
      ws.onopen = () => {
        if (dropped) qc.invalidateQueries();
        dropped = false;
        setOnline(true);
      };
      ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as LiveMessage);
      ws.onclose = () => {
        dropped = true;
        if (closed) return;
        setOnline(false);
        retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      clearTimeout(retry);
    };
  }, [qc]);
  return online;
}
