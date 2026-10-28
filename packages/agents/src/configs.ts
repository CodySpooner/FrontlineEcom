import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, type AgentConfig, type AgentRole, type AgentTypeInfo, type RuntimeId, type Store } from '@frontline/shared';
import { engineInfo } from './engine';
import { BUILTIN_TYPES } from './roles';
import { defaultTools } from './tools';

// Configured agents live in `agent_configs` (migration #50): written once, never edited in place (decision 3).

export function getConfig(db: DatabaseSync, id: string): AgentConfig | undefined {
  const r = db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(id);
  if (!r) return undefined;
  const opt = (k: string) => (r[k] == null ? {} : { [k === 'custom_role_id' ? 'customRoleId' : k]: String(r[k]) });
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...opt('custom_role_id'),
    runtime: String(r.runtime) as RuntimeId,
    ...opt('model'),
    ...opt('effort'),
    tools: JSON.parse(String(r.tools_json)),
    knowledge: JSON.parse(String(r.knowledge_json)),
    permissions: JSON.parse(String(r.permissions_json)),
    createdAt: String(r.created_at),
  };
}

/** An agent type in a store: the seat's role, the custom role narrowing it, and every tool the type may be given. */
export interface AgentType {
  role: AgentRole;
  customRoleId?: string;
  tools: string[];
}

/**
 * A role, or a `builtin:` or custom role id this store may use (its own or an all-stores one, not archived). Undefined
 * otherwise: the routes answer 404 and create nothing (decision 13). A custom role only narrows its base role's tools.
 */
export function resolveType(db: DatabaseSync, storeId: string, type: string): AgentType | undefined {
  if (Object.hasOwn(AGENT_ROLES, type)) {
    const role = type as AgentRole;
    return { role, tools: role === 'market_analyst' ? [...defaultTools(role), 'compare_stores'] : defaultTools(role) };
  }
  const builtin = Object.hasOwn(BUILTIN_TYPES, type) ? BUILTIN_TYPES[type] : undefined;
  const custom = builtin ? undefined : db.prepare('SELECT base_role, tools_json FROM agent_custom_roles WHERE id = ? AND (store_id = ? OR store_id IS NULL) AND archived_at IS NULL').get(type, storeId);
  const role = (builtin?.baseRole ?? custom?.base_role) as AgentRole | undefined;
  if (!role || !Object.hasOwn(AGENT_ROLES, role)) return undefined;
  const narrowed: string[] | undefined = builtin?.tools ?? (custom?.tools_json ? JSON.parse(String(custom.tools_json)) : undefined);
  return { role, customRoleId: type, tools: narrowed ? defaultTools(role).filter((t) => narrowed.includes(t)) : defaultTools(role) };
}

/** Every type the store can use, in list order: the roles, the built-in types, then its custom roles by name. */
export function agentTypes(db: DatabaseSync, storeId: string): AgentTypeInfo[] {
  const roles = Object.entries(AGENT_ROLES).map(([id, r]) => ({ id, name: r.name, description: r.blurb, baseRole: id as AgentRole }));
  const builtins = Object.entries(BUILTIN_TYPES).map(([id, t]) => ({ id, name: t.name, description: t.description, baseRole: t.baseRole }));
  const custom = db
    .prepare('SELECT id, name, description, base_role FROM agent_custom_roles WHERE (store_id = ? OR store_id IS NULL) AND archived_at IS NULL ORDER BY name COLLATE NOCASE')
    .all(storeId)
    .flatMap((r) => (Object.hasOwn(AGENT_ROLES, String(r.base_role)) ? [{ id: String(r.id), name: String(r.name), description: String(r.description), baseRole: r.base_role as AgentRole }] : []));
  return [...roles, ...builtins, ...custom];
}

export type ConfigDraft = Omit<AgentConfig, 'id' | 'storeId' | 'agentId' | 'createdAt'>;

/**
 * The seat default (decision 9), for a conversation started without the Deploy dialog: the type's tools with every
 * draft on and compare_stores off, Store + General knowledge, save findings off, no limits of its own (the store and seat
 * caps apply), and what the store's agents run on today.
 */
export function seatDefault(store: Store, type: AgentType): ConfigDraft {
  const engine = engineInfo(store.connected);
  return {
    ...(type.customRoleId ? { customRoleId: type.customRoleId } : {}),
    runtime: engine.provider === 'claude' ? 'claude' : 'demo',
    ...(engine.model ? { model: engine.model } : {}),
    tools: type.tools.filter((t) => t !== 'compare_stores'),
    knowledge: ['store', 'general'],
    permissions: { saveFindings: 'off' },
  };
}

/**
 * Checks what the Deploy dialog (or an API caller) chose against the type and store, before anything is queued
 * (decision 9). Left-out parts come from the seat default. A failure names the field the dialog shows it on.
 */
// ponytail: until AA-13 discovers runtimes and models, only the seat default's runtime, model and effort are accepted.
export function validateConfig(store: Store, type: AgentType, input: unknown = {}): ConfigDraft | { field: string; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { field: 'config', error: 'config must be an object.' };
  const i = input as Record<string, unknown>;
  const base = seatDefault(store, type);
  if (i.runtime !== undefined && i.runtime !== base.runtime) return { field: 'runtime', error: `This store's agents run on ${base.runtime === 'claude' ? 'Claude' : 'Demo (free)'} for now.` };
  if (i.model !== undefined && i.model !== base.model) return { field: 'model', error: base.model ? `Only ${base.model} is available for now.` : 'Demo (free) has no model to choose.' };
  if (i.effort != null) return { field: 'effort', error: 'Choosing the effort comes later: leave it out.' };
  const tools = i.tools ?? base.tools;
  if (!Array.isArray(tools) || tools.some((t) => typeof t !== 'string')) return { field: 'tools', error: 'tools must be a list of tool names.' };
  const extra = (tools as string[]).find((t) => !type.tools.includes(t));
  if (extra) return { field: 'tools', error: extra === 'compare_stores' ? '"Compare with my other stores" is only for the Analytics Specialist.' : `"${extra}" isn't one of this agent type's tools.` };
  const knowledge = i.knowledge ?? base.knowledge;
  if (!Array.isArray(knowledge) || knowledge.some((k) => k !== 'store' && k !== 'general')) return { field: 'knowledge', error: "Knowledge can be this store's and General only." };
  const p = i.permissions ?? {};
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return { field: 'permissions', error: 'permissions must be an object.' };
  const { budgetUsd, stopAfterMin, saveFindings = 'off' } = p as Record<string, unknown>;
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (budgetUsd != null && !positive(budgetUsd)) return { field: 'permissions.budgetUsd', error: 'Budget for this run must be a positive amount in dollars.' };
  if (budgetUsd != null && base.runtime !== 'claude') return { field: 'permissions.budgetUsd', error: 'Demo (free) costs nothing, so it takes no run budget.' };
  if (stopAfterMin != null && !positive(stopAfterMin)) return { field: 'permissions.stopAfterMin', error: '"Stop after" must be a positive number of minutes.' };
  if (saveFindings !== 'off' && saveFindings !== 'ask' && saveFindings !== 'auto') return { field: 'permissions.saveFindings', error: 'Save findings must be off, ask or auto.' };
  return {
    ...base,
    tools: [...new Set(tools as string[])],
    knowledge: [...new Set(knowledge as AgentConfig['knowledge'])],
    permissions: { ...(budgetUsd != null ? { budgetUsd } : {}), ...(stopAfterMin != null ? { stopAfterMin } : {}), saveFindings },
  };
}

export function saveConfig(db: DatabaseSync, store: Store, type: AgentType, draft: ConfigDraft): AgentConfig {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO agent_configs (id, store_id, agent_id, custom_role_id, runtime, model, effort, tools_json, knowledge_json, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id, store.id, `${store.id}:${type.role}`, draft.customRoleId ?? null, draft.runtime, draft.model ?? null, draft.effort ?? null,
    JSON.stringify(draft.tools), JSON.stringify(draft.knowledge), JSON.stringify(draft.permissions), new Date().toISOString(),
  );
  return getConfig(db, id)!;
}
