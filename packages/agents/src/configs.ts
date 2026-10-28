import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AGENT_ROLES, CODEX_ULTRA, defaultEffort, EFFORT_LABEL, INTEGRATION_KINDS, type AgentConfig, type AgentPreset, type AgentRole, type AgentTypeInfo, type CustomRole, type IntegrationKind, type RoleContract, type RuntimeCapabilities, type RuntimeId, type Store, type ToolGroup } from '@frontline/shared';
import { agentModel } from './claude-engine';
import { engineInfo } from './engine';
import { BUILTIN_TYPES, contractOf, ROLES } from './roles';
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

const toCustomRole = (r: Record<string, unknown>): CustomRole => ({
  id: String(r.id),
  ...(r.store_id == null ? {} : { storeId: String(r.store_id) }),
  baseRole: r.base_role as AgentRole,
  name: String(r.name),
  description: String(r.description),
  instructions: String(r.instructions),
  ...(r.tools_json == null ? {} : { tools: JSON.parse(String(r.tools_json)) }),
  createdAt: String(r.created_at),
  ...(r.archived_at == null ? {} : { archivedAt: String(r.archived_at) }),
});

/**
 * A config's custom role, for its prompt and its name: a `builtin:` type, or one the owner made (archived included: a
 * conversation started with it keeps it).
 */
export function customRole(db: DatabaseSync, id: string): Pick<CustomRole, 'id' | 'name' | 'description' | 'instructions'> | undefined {
  const builtin = Object.hasOwn(BUILTIN_TYPES, id) ? BUILTIN_TYPES[id]! : undefined;
  if (builtin) return { id, name: builtin.name, description: builtin.description, instructions: '' };
  const r = db.prepare('SELECT * FROM agent_custom_roles WHERE id = ?').get(id);
  return r ? toCustomRole(r) : undefined;
}

/** A type's contract: a role's or built-in type's own; a custom role's base contract with its narrowed tools and instructions. */
function typeContract(id: string, custom?: CustomRole): RoleContract {
  if (!custom) return contractOf(Object.hasOwn(BUILTIN_TYPES, id) ? BUILTIN_TYPES[id]! : ROLES[id as AgentRole]);
  const base = contractOf(ROLES[custom.baseRole]);
  return { ...base, tools: custom.tools ? base.tools.filter((t) => custom.tools!.includes(t)) : base.tools, ...(custom.instructions ? { instructions: custom.instructions } : {}) };
}

/** Every type the store can use, in list order: the roles, the built-in types, then its custom roles by name. */
export function agentTypes(db: DatabaseSync, storeId: string): AgentTypeInfo[] {
  const roles = Object.entries(AGENT_ROLES).map(([id, r]) => ({ id, name: r.name, description: r.blurb, baseRole: id as AgentRole, contract: typeContract(id) }));
  const builtins = Object.entries(BUILTIN_TYPES).map(([id, t]) => ({ id, name: t.name, description: t.description, baseRole: t.baseRole, contract: typeContract(id) }));
  const custom = db
    .prepare('SELECT * FROM agent_custom_roles WHERE (store_id = ? OR store_id IS NULL) AND archived_at IS NULL ORDER BY name COLLATE NOCASE')
    .all(storeId)
    .flatMap((r) => (Object.hasOwn(AGENT_ROLES, String(r.base_role)) ? [toCustomRole(r)] : []))
    .map((c) => ({ id: c.id, name: c.name, description: c.description, baseRole: c.baseRole, contract: typeContract(c.id, c) }));
  return [...roles, ...builtins, ...custom];
}

export type CustomRoleDraft = Omit<CustomRole, 'id' | 'storeId' | 'createdAt' | 'archivedAt'> & { allStores: boolean };

/**
 * Checks a custom role the owner made (decision 2): a name, a description and instructions on a role, whose tools it can
 * narrow, never add to. A failure names the form's field.
 */
export function validateCustomRole(input: unknown): CustomRoleDraft | { field: string; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { field: 'name', error: 'Expected a custom role.' };
  const { name, description = '', instructions = '', baseRole, tools, allStores = false } = input as Record<string, unknown>;
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length <= max;
  if (!text(name, 60) || !name.trim()) return { field: 'name', error: 'Name it, in 60 characters or fewer.' };
  if (!text(description, 200)) return { field: 'description', error: 'The description fits in 200 characters.' };
  if (!text(instructions, 4000)) return { field: 'instructions', error: 'The instructions fit in 4,000 characters.' };
  if (typeof baseRole !== 'string' || !Object.hasOwn(AGENT_ROLES, baseRole)) return { field: 'baseRole', error: 'Pick the agent type it builds on.' };
  const allowed: string[] = defaultTools(baseRole as AgentRole);
  if (tools !== undefined && (!Array.isArray(tools) || tools.some((t) => typeof t !== 'string'))) return { field: 'tools', error: 'tools must be a list of tool names.' };
  const picked = tools === undefined ? undefined : [...new Set(tools as string[])];
  const extra = picked?.find((t) => !allowed.includes(t));
  if (extra) return { field: 'tools', error: `A custom role can only narrow the ${AGENT_ROLES[baseRole as AgentRole].name}'s tools: "${extra}" isn't one of them.` };
  if (picked && !picked.length) return { field: 'tools', error: 'Keep at least one tool.' };
  if (typeof allStores !== 'boolean') return { field: 'allStores', error: 'allStores must be true or false.' };
  return { name: name.trim(), description: description.trim(), instructions: instructions.trim(), baseRole: baseRole as AgentRole, ...(picked && picked.length < allowed.length ? { tools: picked } : {}), allStores };
}

export function createCustomRole(db: DatabaseSync, storeId: string, role: CustomRoleDraft): CustomRole {
  const id = randomUUID();
  db.prepare('INSERT INTO agent_custom_roles (id, store_id, base_role, name, description, instructions, tools_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, role.allStores ? null : storeId, role.baseRole, role.name, role.description, role.instructions, role.tools ? JSON.stringify(role.tools) : null, new Date().toISOString(),
  );
  return toCustomRole(db.prepare('SELECT * FROM agent_custom_roles WHERE id = ?').get(id)!);
}

/** A custom role this store may see (its own or an all-stores one), archived or not; undefined is a 404. */
export function getCustomRole(db: DatabaseSync, storeId: string, id: string): CustomRole | undefined {
  const r = db.prepare('SELECT * FROM agent_custom_roles WHERE id = ? AND (store_id = ? OR store_id IS NULL)').get(id, storeId);
  return r ? toCustomRole(r) : undefined;
}

/** Archives or restores a custom role: its conversations keep it; the list and Deploy stop offering it. */
export function archiveCustomRole(db: DatabaseSync, id: string, archived: boolean): CustomRole {
  db.prepare('UPDATE agent_custom_roles SET archived_at = ? WHERE id = ?').run(archived ? new Date().toISOString() : null, id);
  return toCustomRole(db.prepare('SELECT * FROM agent_custom_roles WHERE id = ?').get(id)!);
}

// The Details panel's tool groups (AA-09): a tool goes in the first group it matches.
const GROUPS: [id: string, name: string, access: ToolGroup['access'], match: RegExp, needs?: IntegrationKind][] = [
  ['data', 'Store data', 'read', /^(store_summary|metrics_timeseries|compare_stores|research_feed|squad_log|review_campaigns|search_suppliers)$|^(list|read)_/],
  ['web', 'Web', 'read', /^(WebSearch|WebFetch|fetch_source)$/],
  ['knowledge', 'Knowledge and memory', 'on', /memory|knowledge|research|niche_learning|^(propose_general|propose_card|add_evidence|suggest_link)$/],
  ['creatives', 'Creatives', 'approval', /^create_creative$/, 'higgsfield'],
  ['drafts', 'Drafts and changes', 'approval', /^(propose_(ad|price)_change|draft_|publish_page)/],
  ['squad', 'Squad and records', 'on', /./],
];

/** The config's tools in groups, in GROUPS order; an integration in the tools is its MCP server (reads run, writes ask). */
export function toolGroups(db: DatabaseSync, config: Pick<AgentConfig, 'storeId' | 'tools'>): ToolGroup[] {
  const live = new Set(db.prepare(`SELECT kind FROM integrations WHERE status = 'connected' AND (store_id = ? OR store_id IS NULL)`).all(config.storeId).map((r) => String(r.kind)));
  const groups: ToolGroup[] = [];
  for (const tool of config.tools) {
    const server = INTEGRATION_KINDS[tool as IntegrationKind];
    const [id, name, access, , needs] = server ? [tool, `${server.name} (MCP)`, 'approval' as const, undefined, tool as IntegrationKind] : GROUPS.find((g) => g[3].test(tool))!;
    let group = groups.find((g) => g.id === id);
    if (!group) groups.push((group = { id, name, access, tools: [], ...(needs ? { integration: { kind: needs, connected: live.has(needs) } } : {}) }));
    if (!server) group.tools.push(tool);
  }
  const order = (g: ToolGroup) => GROUPS.findIndex(([id]) => id === g.id) >>> 0; // MCP servers (-1) last
  return groups.sort((a, b) => order(a) - order(b));
}

export type ConfigDraft = Omit<AgentConfig, 'id' | 'storeId' | 'agentId' | 'createdAt'>;

/**
 * The seat default (decision 9), for a conversation started without the Deploy dialog: the type's tools with every
 * draft on and compare_stores off, Store + General knowledge, save findings off, no limits of its own (the store and seat
 * caps apply), and what the store's agents run on: Demo on a demo store, else Claude's default model on this login
 * (`claude`: the discovered list) at its default effort.
 */
export function seatDefault(store: Store, type: AgentType, claude?: RuntimeCapabilities): ConfigDraft {
  const onClaude = engineInfo(store.connected).provider === 'claude';
  const pick = claude?.models.find((m) => m.default);
  const model = pick?.id ?? agentModel();
  const effort = pick ? pick.defaultEffort : defaultEffort(model);
  return {
    ...(type.customRoleId ? { customRoleId: type.customRoleId } : {}),
    runtime: onClaude ? 'claude' : 'demo',
    ...(onClaude ? { model, ...(effort ? { effort } : {}) } : {}),
    tools: type.tools.filter((t) => t !== 'compare_stores'),
    knowledge: ['store', 'general'],
    permissions: { saveFindings: 'off' },
  };
}

/**
 * Checks what the Deploy dialog (or an API caller) chose against the type, the store and what the runtimes can run here
 * (`runtimes`: GET /api/runtimes), before anything is queued (decision 9). Left-out parts come from the seat default. A
 * failure names the field the dialog shows it on.
 */
export function validateConfig(store: Store, type: AgentType, input: unknown, runtimes: RuntimeCapabilities[]): ConfigDraft | { field: string; error: string } {
  input ??= {};
  if (typeof input !== 'object' || Array.isArray(input)) return { field: 'config', error: 'config must be an object.' };
  const i = input as Record<string, unknown>;
  const claude = runtimes.find((r) => r.runtime === 'claude');
  const base = seatDefault(store, type, claude);
  const runtime = i.runtime ?? base.runtime;
  let model: string | undefined;
  let effort: string | undefined;
  if (runtime === 'demo') {
    // Demo stands in for a runtime only where the store's agents run on it: anything else would run on Claude unasked.
    if (base.runtime !== 'demo') return { field: 'runtime', error: 'Demo (free) is only for stores with demo data.' };
    if (i.model != null || i.effort != null) return { field: i.model != null ? 'model' : 'effort', error: 'Demo (free) has no model or effort to choose.' };
  } else if (runtime === 'claude' || runtime === 'codex') {
    const r = runtimes.find((x) => x.runtime === runtime);
    const name = runtime === 'claude' ? 'Claude' : 'Codex';
    if (!r || r.reason) return { field: 'runtime', error: r?.reason ?? `${name} isn't available here.` };
    model = (i.model ?? (base.runtime === runtime ? base.model : r.models.find((m) => m.default)?.id)) as string | undefined;
    // The login's discovered list, or the registry when discovery is down (the dialog says so).
    const m = r.models.find((x) => x.id === model);
    if (!m) return { field: 'model', error: model === undefined ? 'Choose a model.' : `"${String(model)}" isn't on your ${name} login's model list.` };
    if (runtime === 'codex' && i.effort === 'ultra') return { field: 'effort', error: CODEX_ULTRA };
    if (i.effort != null && !m.efforts.includes(i.effort as string)) {
      return { field: 'effort', error: m.efforts.length ? `${m.label} runs at ${m.efforts.map((e) => EFFORT_LABEL[e] ?? e).join(', ')}.` : `${m.label} takes no effort level: leave it out.` };
    }
    effort = (i.effort as string | undefined) ?? (m.defaultEffort === 'ultra' ? undefined : m.defaultEffort);
  } else {
    return { field: 'runtime', error: 'runtime must be claude, codex or demo.' };
  }
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
  if (budgetUsd != null && runtime !== 'claude') {
    return { field: 'permissions.budgetUsd', error: runtime === 'codex' ? 'Codex reports tokens, not dollars, so it takes no run budget: use "Stop after".' : 'Demo (free) costs nothing, so it takes no run budget.' };
  }
  if (stopAfterMin != null && !positive(stopAfterMin)) return { field: 'permissions.stopAfterMin', error: '"Stop after" must be a positive number of minutes.' };
  if (stopAfterMin == null && runtime === 'codex') return { field: 'permissions.stopAfterMin', error: 'Codex needs a "Stop after" limit: dollar caps don\'t apply to it.' };
  if (saveFindings !== 'off' && saveFindings !== 'ask' && saveFindings !== 'auto') return { field: 'permissions.saveFindings', error: 'Save findings must be off, ask or auto.' };
  return {
    ...(base.customRoleId ? { customRoleId: base.customRoleId } : {}),
    runtime,
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    tools: [...new Set(tools as string[])],
    knowledge: [...new Set(knowledge as AgentConfig['knowledge'])],
    permissions: { ...(budgetUsd != null ? { budgetUsd } : {}), ...(stopAfterMin != null ? { stopAfterMin } : {}), saveFindings },
  };
}

const toPreset = (r: Record<string, unknown>): AgentPreset => ({
  id: String(r.id),
  ...(r.store_id == null ? {} : { storeId: String(r.store_id) }),
  name: String(r.name),
  config: JSON.parse(String(r.config_json)),
  createdAt: String(r.created_at),
});

/**
 * A type's presets for the Deploy dialog (decision 2): its built-in Default first, then the owner's saved ones for it
 * (for a role, its custom roles' too). The Default holds the seat default's tools, knowledge and limits under the type's
 * usual task, and never a runtime, model or effort. A custom role starts from its base type's. Undefined is a 404.
 */
export function listPresets(db: DatabaseSync, storeId: string, typeId: string): AgentPreset[] | undefined {
  const type = resolveType(db, storeId, typeId);
  if (!type) return undefined;
  const builtin: AgentPreset = {
    id: `default:${typeId}`,
    name: (Object.hasOwn(BUILTIN_TYPES, typeId) ? BUILTIN_TYPES[typeId]! : ROLES[type.role]).task,
    builtin: true,
    createdAt: '', // defined in code, never stored
    config: { role: type.role, ...(type.customRoleId ? { customRoleId: type.customRoleId } : {}), tools: type.tools.filter((t) => t !== 'compare_stores'), knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } },
  };
  const saved = db
    .prepare('SELECT * FROM agent_presets WHERE store_id = ? OR store_id IS NULL ORDER BY name COLLATE NOCASE')
    .all(storeId)
    .map(toPreset)
    .filter((p) => (type.customRoleId ? p.config.customRoleId === typeId : p.config.role === type.role));
  return [builtin, ...saved];
}

/**
 * Saves the Deploy dialog's choices as a preset, checked as a deploy is (unknown keys dropped). It keeps a runtime, model
 * or effort only when one was chosen, so an all-stores preset still fits a store that runs on something else.
 */
export function savePreset(db: DatabaseSync, store: Store, input: unknown, runtimes: RuntimeCapabilities[]): AgentPreset | { status: 400 | 404; error: string; field?: string } {
  const b = (typeof input === 'object' && input !== null && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const { name, type: typeId, config = {}, objective, allStores = false } = b;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) return { status: 400, field: 'name', error: 'Name the preset, in 60 characters or fewer.' };
  if (objective !== undefined && (typeof objective !== 'string' || objective.length > 2000)) return { status: 400, field: 'objective', error: 'The objective template fits in 2,000 characters.' };
  if (typeof allStores !== 'boolean') return { status: 400, field: 'allStores', error: 'allStores must be true or false.' };
  const type = typeof typeId === 'string' ? resolveType(db, store.id, typeId) : undefined;
  if (!type) return { status: 404, error: 'Agent type not found' };
  const draft = validateConfig(store, type, config, runtimes);
  if ('error' in draft) return { status: 400, ...draft };
  const chosen = config as Record<string, unknown>;
  const preset: AgentPreset['config'] = {
    role: type.role,
    ...(draft.customRoleId ? { customRoleId: draft.customRoleId } : {}),
    ...(chosen.runtime !== undefined ? { runtime: draft.runtime } : {}),
    ...(chosen.model !== undefined && draft.model ? { model: draft.model } : {}),
    ...(chosen.effort != null && draft.effort ? { effort: draft.effort } : {}),
    tools: draft.tools,
    knowledge: draft.knowledge,
    permissions: draft.permissions,
    ...(objective?.trim() ? { objective: objective.trim() } : {}),
  };
  const id = randomUUID();
  db.prepare('INSERT INTO agent_presets (id, store_id, name, config_json, created_at) VALUES (?, ?, ?, ?, ?)').run(id, allStores ? null : store.id, name.trim(), JSON.stringify(preset), new Date().toISOString());
  return toPreset(db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(id)!);
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
