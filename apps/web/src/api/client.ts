// UI-03 data layer: typed fetchers + react-query hooks over the local API, and the /api/live socket.
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Achievement,
  ActionLogEntry,
  Agent,
  AgentRun,
  AgentRunDetail,
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
  Commander,
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
  KnowledgeDoc,
  KnowledgeKind,
  LiveMessage,
  MemoryInput,
  Mission,
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
  XpEvent,
} from '@frontline/shared';
import { apiUp, waitForApi } from '../lib/restart';
import { importing } from '../lib/sync';
import { applyRunEvent, isLive } from '../lib/transcript';
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (r.status === 204) return undefined as T;
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `${init?.method ?? 'GET'} ${path} failed (${r.status})`);
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
export const useMissions = () => useQuery({ queryKey: ['missions'], queryFn: () => api<Mission[]>('/api/missions') });
export const useCommander = () => useQuery({ queryKey: ['commander'], queryFn: () => api<Commander>('/api/commander') });
export const useAchievements = () => useQuery({ queryKey: ['achievements'], queryFn: () => api<Achievement[]>('/api/achievements') });

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

/** What earned an agent its XP, newest first (the ledger behind its level). */
export const useAgentXp = (agentId: string) => useQuery({ queryKey: ['xp', agentId], queryFn: () => api<XpEvent[]>(`/api/agents/${encodeURIComponent(agentId)}/xp`) });
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

export function useDeleteFlowDraft() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<void>(`/api/flow-drafts/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['flow-drafts'] }) });
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

export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<AppNotification[]>('/api/notifications?limit=40') });

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
        if (m.event.type === 'order') ['summary', 'orders', 'top-products', 'missions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      } else if (m.type === 'run_event') qc.setQueryData<AgentRunDetail>(['run', m.runId], (d) => d && applyRunEvent(d, m.event));
      else if (m.type === 'run') {
        // Finished: refetch the stored transcript, which also covers events that raced ahead of the POST response.
        if (isLive(m.run)) qc.setQueryData<AgentRunDetail>(['run', m.run.id], (d) => d && { ...d, ...m.run });
        else qc.invalidateQueries({ queryKey: ['run', m.run.id] });
        qc.invalidateQueries({ queryKey: ['runs', m.run.agentId] });
        qc.invalidateQueries({ queryKey: ['agents'] });
        qc.invalidateQueries({ queryKey: ['memory', m.run.storeId] });
        qc.invalidateQueries({ queryKey: ['creatives'] });
        qc.invalidateQueries({ queryKey: ['order-issues'] });
        qc.invalidateQueries({ queryKey: ['flow-drafts'] });
        qc.invalidateQueries({ queryKey: ['page-drafts'] });
        // Product Hunter (AI Research, the daily scan) adds its finds to the research feed.
        if (!isLive(m.run)) qc.invalidateQueries({ queryKey: ['research'] });
      }
      if (m.type === 'approval' || m.type === 'run' || m.type === 'xp') {
        qc.invalidateQueries({ queryKey: ['missions'] });
        qc.invalidateQueries({ queryKey: ['commander'] });
        // Automation fires start runs or ask for approval; the log and "last fired" follow.
        ['automation-runs', 'automations'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        qc.invalidateQueries({ queryKey: ['usage'] });
      }
      if (m.type === 'notification') qc.setQueryData<AppNotification[]>(['notifications'], (old) => old && [m.notification, ...old]);
      if (m.type === 'xp') {
        ['agents', 'achievements', 'xp'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        // XpToasts shows it.
        window.dispatchEvent(new CustomEvent('frontline:xp', { detail: m }));
      } else if (m.type === 'approval') {
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
