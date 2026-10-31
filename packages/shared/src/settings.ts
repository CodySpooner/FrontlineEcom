// Settings (docs/features/settings.md, docs/backlog/settings.md): section slugs and the one link builder the web and
// the server's notifications use.

/** Every Settings section slug. The web lists only the ones with content (`SECTIONS` in apps/web/src/settings/Layout.tsx). */
export const SETTINGS_SECTIONS = [
  'account',
  'appearance',
  'notifications',
  'general',
  'stores',
  'agents',
  'integrations',
  'knowledge',
  'product-research',
  'automation',
  'usage',
  'data',
  'history',
  'advanced',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Settings → Notifications categories (decision 12): each can be off, and each has its own Windows toast switch. */
export type NotificationCategory = 'approvals' | 'agentDone' | 'errors' | 'researchAlerts' | 'digest' | 'usageAlerts';
export const NOTIFICATION_CATEGORIES: Record<NotificationCategory, string> = { approvals: 'Approvals', agentDone: 'Agent finished', errors: 'Errors', researchAlerts: 'Research alerts', digest: 'Morning digest', usageAlerts: 'Usage alerts' };

/** The connections whose every sync sets a store's currency or timezone: the store page shows those read-only (ST-18). */
export const SET_BY_SYNC: Record<'currency' | 'timezone', readonly string[]> = { currency: ['shopify', 'tiktok_shop', 'etsy', 'amazon', 'woocommerce'], timezone: ['shopify', 'woocommerce'] };

/** `/settings/<section>[/<id>][?store=<id>][#<setting>]`: the only way to link into Settings. */
export function settingsUrl(section: SettingsSection, o: { id?: string; store?: string; setting?: string } = {}) {
  return `/settings/${section}${o.id ? `/${encodeURIComponent(o.id)}` : ''}${o.store ? `?store=${encodeURIComponent(o.store)}` : ''}${o.setting ? `#${o.setting}` : ''}`;
}

// The settings registry (decision 5): one entry per setting the app exposes, except integration fields and secrets
// (INTEGRATION_KINDS owns those). An entry is added in the same commit as its consumer; `settings.test.ts` checks every
// `consumers` and `proof` path still exists. Moved or renamed a consumer? Update its entry here: any lane may.

export type SettingScope = 'personal' | 'workspace' | 'store' | 'device';
/** Where an effective value came from (decision 4). App and personal values the owner saved read as `workspace`. */
export type SettingOrigin = 'store' | 'workspace' | 'default' | 'env' | 'locked' | 'demo';

/** GET /api/config/limits: a limit Frontline sets, read-only, its value said from the constant that enforces it (ST-24b). */
export interface FrontlineLimit {
  label: string;
  value: string;
}
/** The documents `/api/config` reads and writes: `store_caps` is one store's override document. */
export type ConfigDoc = 'app' | 'personal' | 'workspace' | 'store_caps';

/** GET /api/config?store=: effective values by registry id, where each came from, and each document's version (0: no row). */
export interface ConfigView {
  values: Record<string, unknown>;
  origins: Record<string, SettingOrigin>;
  versions: Partial<Record<'app' | 'personal' | 'workspace' | `store_caps:${string}`, number>>;
  /** PATCH /api/config only: the change rows this save wrote, for the save bar's applying… / applied (ST-09). */
  changes?: ConfigChange[];
}
/** A change row's state (decision 6): `saved` took effect when committed; a background job's row goes `applying`, then `applied` or `failed`. */
export type ChangeState = 'saved' | 'applying' | 'applied' | 'failed';
/** One Change History row (`settings_changes`, decision 15). Never a secret value: a secret's row says only `replaced` or `removed`. */
export interface ConfigChange {
  id: string;
  at: string;
  /** Every row one save wrote shares it. */
  requestId?: string;
  /** `owner`, `import`, `migration`, `sync:<kind>` or `system`. */
  actor: string;
  scope: string;
  storeId?: string;
  /** Kept after the store is deleted. */
  storeName?: string;
  setting: string;
  /** Absent for a secret (and on the side a row has none of). */
  before?: unknown;
  after?: unknown;
  state: ChangeState;
  /** An automation's name, a secret's `replaced`/`removed`, or why a job couldn't apply. */
  detail?: string;
}
/** POST /api/config/impact (ST-10): one sentence a save would earn, its counts from real queries. */
export interface ConfigImpact {
  setting: string;
  /** The store it's about, when it's one store's. */
  storeId?: string;
  text: string;
}
/** GET /api/config/automation (ST-29, decision 14): the pause, and the runs automations started that are still going. */
export interface AutomationStatus {
  paused: boolean;
  /** When it was paused (its change row), while it is. */
  pausedAt: string | null;
  running: AutomationRunning[];
}
export interface AutomationRunning {
  runId: string;
  ruleName: string;
  storeId: string;
  storeName: string;
  agentId: string;
  status: 'queued' | 'running';
  startedAt: string;
}
/** POST /api/config/automation/cancel-running: what really happened to each run, read once it ended. */
export interface AutomationCancelled {
  runId: string;
  ruleName: string;
  storeName: string;
  status: import('./index').RunStatus;
  approvals: { id: string; title: string; status: string }[];
  /** "Stopped before it changed anything", "Stopped; its N requests stay in Requests" or "Already finished". */
  outcome: string;
}

/**
 * The approval map (ST-30, decision 14): one row per kind of action, with the approval kinds (APPROVAL_KINDS keys, each
 * in exactly one row) and the agent tools behind it. `where` is the settings section, or an app path, it's changed in.
 */
export const APPROVAL_MAP: { category: string; kinds: string[]; tools: string[]; does: string; decides: string; where: { label: string; to: string } }[] = [
  { category: 'Read-only research', kinds: ['kb.research'], tools: ['recommend_research', 'fetch_source'], does: 'Self-directed knowledge research: it reads sources and changes nothing outside the app.', decides: "The store's Knowledge controls: on its own, or each task asks you first.", where: { label: 'Knowledge', to: '/settings/knowledge' } },
  {
    category: 'Drafts', kinds: [], tools: ['draft_page', 'draft_flow', 'draft_theme_change'],
    does: "Page and flow drafts stay in the app. A theme draft is an unpublished copy of your live theme with the agent's files, made in your Shopify store before you're asked (never at Suggest): the live theme isn't touched, the copy takes one of Shopify's 20 theme slots, and saying no deletes it.",
    decides: "No approval to draft. Making a theme draft live asks you (Publishing).", where: { label: "The agent's autonomy, on AI Agents", to: '/agents' },
  },
  { category: 'Live store edits', kinds: ['store.set_price', 'store.add_products'], tools: ['propose_price_change', 'request_approval'], does: 'Changing a price, adding products to the store.', decides: 'Always you.', where: { label: 'Not changeable', to: '' } },
  { category: 'Publishing', kinds: ['store.publish_page', 'store.publish_theme'], tools: ['publish_page', 'draft_theme_change'], does: 'Publishing a page or making a theme draft live.', decides: 'Always you.', where: { label: 'Not changeable', to: '' } },
  { category: 'Launching ads', kinds: ['tool_use'], tools: ['propose_ad_change'], does: "Meta Ads tools: each write asks you (a connected tool's write); budget, bid and status changes go through propose_ad_change.", decides: 'Always you.', where: { label: 'Not changeable', to: '' } },
  {
    category: 'Spending money', kinds: ['ads.set_budget', 'ads.pause_campaign', 'creative.generate'], tools: ['propose_ad_change', 'create_creative'], does: 'Ad budget changes, pausing campaigns, and creatives that spend Higgsfield credits.',
    decides: "You, or autopilot for ad budget changes and pausing campaigns: an agent set to Autopilot approves its own within the store's daily amount. Creatives always ask.", where: { label: 'Autopilot rules', to: '/settings/automation' },
  },
  { category: 'Deleting data', kinds: [], tools: [], does: 'Not available: no tool does this.', decides: '', where: { label: '', to: '' } },
  { category: 'Contacting customers', kinds: [], tools: [], does: 'Not available: no tool does this.', decides: '', where: { label: '', to: '' } },
  {
    category: 'App-internal', kinds: ['kb.save', 'kb.promote', 'niche.promote_learning', 'save_niche_pack', 'question'], tools: ['save_finding', 'propose_general', 'promote_niche_learning', 'request_approval', 'ask_owner'],
    does: 'Saving a finding, promoting knowledge to General, sharing a learning with the niche, saving a niche pack, answering a question.',
    decides: "You, or for findings the agent's save-findings setting on Deploy; Knowledge's approval and review for what reaches the knowledge base.", where: { label: 'Knowledge', to: '/settings/knowledge' },
  },
];
/** GET /api/config/checklist (ST-17): one setup step, `done` only when its real condition holds. */
export interface SetupItem {
  id: string;
  title: string;
  done: boolean;
  link: string;
  /** Why it's still open. */
  detail: string;
}
/** GET /api/stores/:id/impact (ST-19): what deleting the store removes, and what stays. */
export interface StoreDeleteImpact {
  /** e.g. `{ count: 8, text: '8 agents' }`. */
  removes: { count: number; text: string }[];
  keeps: { count: number; text: string }[];
  /** Its Codex work folder, when Codex has run for it: it stays on disk. */
  codexFolder?: string;
}
/** GET /api/config/changes: newest first; `next` is the cursor of the page after. */
export interface ConfigChangesPage {
  changes: ConfigChange[];
  next?: string;
}
/** PATCH /api/config: every document in one transaction; `unset` deletes an override key (back to inheriting). */
export interface ConfigWrite {
  documents: { doc: ConfigDoc; storeId?: string; version: number; set?: Record<string, unknown>; unset?: string[] }[];
}
/** When a saved value takes effect; drives the copy. `job`: Saved → Applying → Applied (a background job). */
export type SettingApplies = 'now' | 'new runs' | 'next tick' | 'next hourly pass' | 'next sync' | 'next daily plan' | 'job';

interface SettingBase {
  id: string;
  section: SettingsSection;
  label: string;
  help: string;
  synonyms?: string[];
  /** Where it can be set. A locked entry lists where it applies; nothing writes it. */
  scopes: SettingScope[];
  /** With more than one scope: a store without its own value takes the workspace one (`workspace`), or never (`none`). */
  inherits?: 'workspace' | 'none';
  /** The value when nothing is stored. Or `fill`: what boot fills it with (decision 7). */
  default?: unknown;
  fill?: string;
  /** null clears it. */
  nullable?: boolean;
  /** Where the value is stored, or the owner parser that validates it, as `path#symbol`. */
  owner: string;
  applies: SettingApplies;
  locked?: boolean;
  export?: boolean;
  device?: boolean;
  /** Import starts it unticked (decision 15). */
  safeguard?: boolean;
  /** Where the value is read, as `path#symbol`. */
  consumers: string[];
  /** On every editable entry: `path#test name`, the test showing a consumer's behaviour change with the value. */
  proof?: string;
}

export type SettingDef = SettingBase &
  (
    | { type: 'boolean' }
    | { type: 'number'; min: number; max: number; integer?: boolean }
    | { type: 'string'; maxLength?: number; pattern?: string; enum?: readonly string[] }
    | { type: 'list'; maxItems: number; maxLength?: number; pattern?: string; enum?: readonly string[] }
    /** An object keyed by `keys` (any key when absent; the owner checks dynamic ones), with values in min–max. */
    | { type: 'map'; keys?: readonly string[]; min?: number; max?: number; integer?: boolean }
  );

const n = (v: unknown, d: { min: number; max: number; integer?: boolean }) => typeof v === 'number' && Number.isFinite(v) && v >= d.min && v <= d.max && (!d.integer || Number.isInteger(v));
const s = (v: unknown, d: { maxLength?: number; pattern?: string; enum?: readonly string[] }) =>
  typeof v === 'string' && (!d.maxLength || v.length <= d.maxLength) && (!d.pattern || new RegExp(d.pattern).test(v)) && (!d.enum || d.enum.includes(v));
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Checks a value against its entry, for the server's writer and the web's rows. Returns the reason, or null when valid. */
export function validateSetting(def: SettingDef, v: unknown): string | null {
  if (v === null) return def.nullable ? null : `${def.label} can't be empty`;
  switch (def.type) {
    case 'boolean':
      return typeof v === 'boolean' ? null : `${def.label} must be on or off`;
    case 'number':
      return n(v, def) ? null : `${def.label} must be ${def.integer ? 'a whole number ' : ''}from ${def.min} to ${def.max}`;
    case 'string':
      return s(v, def) ? null : def.enum ? `${def.label} must be one of ${def.enum.join(', ')}` : `${def.label} must be valid text${def.maxLength ? ` up to ${def.maxLength} characters` : ''}`;
    case 'list':
      return Array.isArray(v) && v.length <= def.maxItems && v.every((x) => s(x, def)) ? null : `${def.label} must be a list of up to ${def.maxItems}${def.enum ? ` of ${def.enum.join(', ')}` : ' valid items'}`;
    case 'map':
      return isObj(v) && Object.entries(v).every(([k, x]) => (!def.keys || def.keys.includes(k)) && (def.min === undefined || n(x, { min: def.min, max: def.max ?? Infinity, integer: def.integer })))
        ? null
        : `${def.label} has an unknown key or a value out of range`;
  }
}

/** Omit over each member of a union. */
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
const kb = (field: string, d: Without<SettingDef, 'id' | 'section' | 'scopes' | 'inherits' | 'owner' | 'export'>) =>
  ({ id: `kb.${field}`, section: 'knowledge', scopes: ['workspace', 'store'], inherits: 'none', owner: 'apps/server/src/kb/autonomy.ts#parseControls', export: true, ...d }) as SettingDef;
const pr = (field: string, d: Without<SettingDef, 'id' | 'section' | 'scopes' | 'owner' | 'export'>) =>
  ({ id: `pr.${field}`, section: 'product-research', scopes: ['store'], owner: 'apps/server/src/product-research/profile.ts#saveProfile', export: true, ...d }) as SettingDef;
const AUTONOMY = 'apps/server/src/kb/autonomy.test.ts';
const DOMAIN = '^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$';

const notif = (key: string, label: string, help: string, proof: string, consumers: string[], safeguard?: boolean): SettingDef => ({
  id: `notifications.${key}`, section: 'notifications', type: 'boolean', label, help, scopes: ['personal'], default: true, owner: 'apps/server/src/settings.ts#updateSettings', applies: 'now', export: true, ...(safeguard && { safeguard }), consumers, proof,
});
const cap = (key: string, label: string, help: string, d: { section: SettingsSection; default: number; consumers: string[]; proof: string }): SettingDef => ({
  id: `caps.${key}`, type: 'number', min: 0, max: 1e6, label, help, scopes: ['workspace', 'store'], inherits: 'workspace', fill: `today's built-in default, ${d.default}`, owner: 'apps/server/src/settings.ts#updateCaps', applies: 'new runs', export: true, safeguard: true, ...d,
});
const autopilot = (kind: string, label: string, proof: string): SettingDef => ({
  id: `autopilot.${kind}`, section: 'automation', type: 'map', keys: ['enabled', 'maxUsdPerDay'], label, help: 'Auto-approves within this daily dollar amount; off asks you first. For agents set to Autopilot.', scopes: ['store'], default: null, nullable: true, owner: 'apps/server/src/settings.ts#updateCaps', applies: 'now', export: true, safeguard: true, consumers: ['packages/agents/src/tools.ts#requestApproval'], proof,
});
const store = (field: string, d: Without<SettingDef, 'id' | 'section' | 'scopes' | 'owner' | 'export'>) =>
  ({ id: `store.${field}`, section: 'stores', scopes: ['store'], owner: 'apps/server/src/stores.ts#parseStoreInput', export: true, ...d }) as SettingDef;
const NOTIFY = 'apps/server/src/config/notifications.test.ts';
const USAGE = 'apps/server/src/config/usage-alerts.test.ts';
const GENERAL = 'apps/server/src/config/general.test.ts';
const PROMPT = 'packages/agents/src/prompt.test.ts';
const COMMON = 'apps/server/src/connectors/common.test.ts';
const DEFAULTS = 'apps/server/src/config/agent-defaults.test.ts';
const LIMITS = 'apps/server/src/config/run-limits.test.ts';
const AUTOSAVE = 'apps/server/src/config/auto-save.test.ts';
const PRPROFILE = 'apps/server/src/config/pr-profile.test.ts';
const PRASSUME = 'apps/server/src/config/pr-assumptions.test.ts';
const PAUSE = 'apps/server/src/config/automation.test.ts';
const runLimit = (key: string, d: Without<SettingDef, 'id' | 'section' | 'scopes' | 'owner' | 'applies' | 'export'>) =>
  ({ id: `runs.${key}`, section: 'agents', scopes: ['workspace'], owner: 'apps/server/src/config/agent-defaults.ts#checkRunLimits', applies: 'now', export: true, ...d }) as SettingDef;
const agentDefault = (key: string, d: Without<SettingDef, 'id' | 'section' | 'scopes' | 'inherits' | 'default' | 'owner' | 'applies' | 'export'>) =>
  ({ id: `agentDefaults.${key}`, section: 'agents', scopes: ['workspace', 'store'], inherits: 'workspace', default: undefined, owner: 'apps/server/src/config/agent-defaults.ts#checkAgentDefaults', applies: 'new runs', export: true, ...d }) as SettingDef;

export const SETTINGS: SettingDef[] = [
  { id: 'profile.name', section: 'account', type: 'string', maxLength: 40, label: 'Display name', help: 'Shown on the profile chip.', scopes: ['personal'], default: 'Cody', owner: 'apps/server/src/settings.ts#updateSettings', applies: 'now', export: true, consumers: ['apps/web/src/components/Hero.tsx#HeroControls'], proof: 'apps/web/src/settings/sections/Account.test.tsx#a rename persists across a refetch and shows on the chip' },
  { id: 'appearance.motion', section: 'appearance', type: 'string', enum: ['system', 'reduce'], label: 'Motion', help: "Follow Windows' setting, or always reduce animation.", synonyms: ['animation', 'reduced motion'], scopes: ['personal'], default: 'system', owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/web/src/index.css#data-motion', 'apps/web/src/ecosystem/renderer.ts#reducedMotion'], proof: 'apps/web/src/settings/sections/Appearance.test.tsx#Always reduce sets <html data-motion> only once the server confirms; a refusal leaves it; Follow Windows clears it' },

  notif('approvals', 'Requests to approve', 'When an agent asks before it acts.', 'apps/server/src/settings.test.ts#notifications: approvals and agentDone each silence their own kind, and only it', ['apps/server/src/settings.ts#CATEGORY'], true),
  notif('agentDone', 'Finished work', 'When an agent finishes a task.', 'apps/server/src/settings.test.ts#notifications: approvals and agentDone each silence their own kind, and only it', ['apps/server/src/settings.ts#CATEGORY']),
  notif('errors', 'Errors', 'A failed sync, backup or run.', 'apps/server/src/settings.test.ts#notifications: approvals raise one, prefs silence a kind, mark read', ['apps/server/src/settings.ts#CATEGORY'], true),
  notif('digest', 'Daily digest', 'One summary a day.', 'apps/server/src/digest.test.ts#the loop sends one digest a day from 8:00, and none while it is turned off', ['apps/server/src/digest.ts#startDigestLoop']),
  notif('researchAlerts', 'Research alerts', 'A watched product changed.', 'apps/server/src/product-research/alerts.test.ts#scheduled checks: the first records the result, a later change alerts once, never twice; with research alerts off it is stored but not notified', ['apps/server/src/product-research/alerts.ts#checkWatch']),
  { id: 'notifications.digestHour', section: 'notifications', type: 'number', min: 0, max: 23, integer: true, label: 'Digest time', help: 'The hour the morning digest goes, in the workspace timezone.', synonyms: ['morning digest'], scopes: ['personal'], default: 8, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/server/src/digest.ts#startDigestLoop'], proof: `${USAGE}#the digest goes at the hour set, in the workspace zone; turned on after that hour, it still goes that day` },
  { id: 'notifications.usageAlerts', section: 'notifications', type: 'boolean', label: 'Usage alerts', help: "A store's AI spend or generation credits today reached a share of its daily cap.", scopes: ['personal'], default: true, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/server/src/config/usage-alerts.ts#usageAlert'], proof: `${USAGE}#a usage alert fires once at 80% of a cap, not again that day, again the next day; with alerts off, none` },
  { id: 'notifications.usageAlertPct', section: 'notifications', type: 'number', min: 50, max: 100, integer: true, label: 'Usage alert share', help: 'The share of a daily cap that sends the alert.', scopes: ['personal'], default: 80, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/server/src/config/usage-alerts.ts#usageAlert'], proof: `${USAGE}#a usage alert fires once at 80% of a cap, not again that day, again the next day; with alerts off, none` },
  ...(Object.entries(NOTIFICATION_CATEGORIES) as [NotificationCategory, string][]).map(([key, name]): SettingDef => ({
    id: `notifications.toasts.${key}`, section: 'notifications', type: 'boolean', label: `Windows toast: ${name}`, help: "Also as a Windows toast when Frontline isn't the focused window.", scopes: ['personal'], default: true, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true,
    consumers: ['apps/server/src/settings.ts#toastBlock', 'apps/desktop/src/toast.ts#shouldToast'], proof: `${NOTIFY}#toasts off for a category, or quiet hours across midnight in the workspace zone, store with toast: false`,
  })),
  { id: 'notifications.quietHours', section: 'notifications', type: 'map', keys: ['from', 'to'], min: 0, max: 23, integer: true, nullable: true, label: 'Quiet hours', help: 'No Windows toasts from the first hour to the second, in the workspace timezone; they are not sent, not held. The bell still gets everything.', scopes: ['personal'], default: null, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/server/src/settings.ts#toastBlock'], proof: `${NOTIFY}#toasts off for a category, or quiet hours across midnight in the workspace zone, store with toast: false` },
  { id: 'notifications.mutedStores', section: 'notifications', type: 'list', maxItems: 500, maxLength: 64, label: 'Stores to notify me about', help: "The stores you untick are left out. Off: not kept; turning it back on doesn't bring them back.", scopes: ['personal'], default: [], owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['apps/server/src/settings.ts#notify'], proof: `${NOTIFY}#a category turned off or a muted store stores nothing; info always shows` },

  { id: 'baseCurrency', section: 'general', type: 'string', pattern: '^[A-Za-z]{3}$', label: 'Display currency', help: "Display currency for totals across stores. It doesn't change any store's selling currency.", synonyms: ['base currency'], scopes: ['workspace'], default: 'USD', owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'job', export: true, consumers: ['apps/server/src/fx.ts#fxFor', 'apps/server/src/product-research/facts.ts#factKeys'], proof: `${GENERAL}#after the job, All-stores discovery returns facts in the new currency` },
  { id: 'timezone', section: 'general', type: 'string', maxLength: 64, label: 'Workspace timezone', help: 'Schedules, the morning digest, quiet hours and every daily cap run on this clock.', synonyms: ['time zone'], scopes: ['workspace'], fill: "this computer's zone, once", owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['packages/agents/src/squads.ts#workspaceZone'], proof: "apps/server/src/config/timezone.test.ts#schedules run on the workspace zone's wall clock: 9:00 there, and a 2:30 rule once on both DST nights" },

  cap('agentCostPerDay', 'AI usage per day', "A store's agents stop for the day past it. An estimate from usage.", { section: 'agents', default: 5, consumers: ['packages/agents/src/runs.ts#budgetFor', 'apps/server/src/settings.ts#getCaps', 'apps/web/src/lib/usage.ts#capFrom'], proof: "apps/server/src/routes/agents-runs.test.ts#the store's daily AI budget blocks new runs once spent" }),
  cap('adSpendChangePerDay', 'Ad budget changes per day', "Checked when an agent proposes a raise, converted to USD; with no exchange rate the check is skipped and you decide. Cuts and pauses don't count; your own approvals aren't limited.", { section: 'usage', default: 100, consumers: ['packages/agents/src/tools.ts#adSpendChangePerDay'], proof: "apps/server/src/routes/agents-ads.test.ts#the owner's cap on added spend and bad input stop a proposal before asking" }),
  cap('higgsfieldCreditsPerDay', 'Higgsfield credits per day', 'For image and video renders, charged when you approve one. Renders waiting on you count.', { section: 'usage', default: 200, consumers: ['packages/agents/src/tools.ts#higgsfieldCreditsPerDay'], proof: "apps/server/src/routes/agents-creatives.test.ts#the store's daily credit cap stops generation before asking" }),

  // Agent defaults (decision 9): no default of their own (undefined); unset is the runtime's, as before.
  agentDefault('runtime', { type: 'string', enum: ['claude', 'codex'], label: 'Default runtime', help: 'What new conversations run on. Scheduled and background work runs on Claude on live stores and on the demo engine on demo stores, never on Codex.', consumers: ['packages/agents/src/configs.ts#seatDefault', 'packages/agents/src/runs.ts#defaults.runtime'], proof: `${DEFAULTS}#a demo store's conversation stays on the demo engine; picking Claude there takes the default model` }),
  agentDefault('model', { type: 'string', maxLength: 100, label: 'Default model', help: 'For new conversations on the default runtime, and for scheduled and background work when that runtime is Claude.', consumers: ['packages/agents/src/configs.ts#seatDefault', 'packages/agents/src/claude-engine.ts#input.defaults?.model'], proof: `${DEFAULTS}#the workspace model reaches a new conversation and a run without a config; a store's own wins there only` }),
  agentDefault('effort', { type: 'string', maxLength: 20, label: 'Default effort', help: "The default model's effort level.", consumers: ['packages/agents/src/configs.ts#seatDefault', 'packages/agents/src/claude-engine.ts#input.defaults?.effort'], proof: `${DEFAULTS}#the workspace model reaches a new conversation and a run without a config; a store's own wins there only` }),
  agentDefault('stopAfterMin', { type: 'number', min: 1, max: 1440, integer: true, label: 'Stop a run after', help: 'Minutes of work. New conversations only; Codex needs it.', consumers: ['packages/agents/src/configs.ts#seatDefault'], proof: `${DEFAULTS}#"stop after" reaches new conversations only` }),
  agentDefault('knowledge', { type: 'string', enum: ['all', 'store'], label: 'Knowledge', help: "This store's and General, or this store's only.", consumers: ['packages/agents/src/configs.ts#seatDefault', 'packages/agents/src/runs.ts#defaults?.knowledge'], proof: `${DEFAULTS}#store only leaves General out of retrieval, for a run without a config and a new conversation` }),

  // Run limits (decision 9): workspace only, read at each failure and each pump; lowering one never stops a run going.
  runLimit('retries', { type: 'number', min: 0, max: 2, integer: true, default: 2, label: 'Retries', help: 'Times a run is tried again when the AI service is busy or failing, unless it already changed something.', consumers: ['packages/agents/src/runs.ts#runLimits(db).retries'], proof: `${LIMITS}#retries 0: a busy service isn't tried again; 1: once` }),
  runLimit('atOnce', { type: 'number', min: 1, max: 5, integer: true, default: 3, label: 'Runs at once', help: 'Across every store.', consumers: ['packages/agents/src/runs.ts#limits'], proof: `${LIMITS}#a total of 1: a second store's run queues until the first is done` }),
  runLimit('perStore', { type: 'number', min: 1, max: 3, integer: true, default: 2, label: 'Runs at once per store', help: 'Never above the total. A team runs at most this many of its tasks at once.', consumers: ['packages/agents/src/runs.ts#limits', 'packages/agents/src/teams.ts#atOnce'], proof: `${LIMITS}#per store 1: a second run on the store queues; lowered with 2 going, both go on and the next waits` }),

  autopilot('ads.set_budget', 'Change ad budgets', 'apps/server/src/routes/agents-approvals.test.ts#approves on its own within the store cap for that kind, then asks'),
  autopilot('ads.pause_campaign', 'Pause campaigns', 'apps/server/src/routes/agents-approvals.test.ts#pauses and cuts count the budget they touch against their autopilot cap; only raises count as added spend'),

  // Store fields.
  store('color', { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', label: 'Color', help: 'Marks the store across the app.', synonyms: ['colour'], default: '#ff2a3a', applies: 'now', consumers: ['apps/web/src/components/StoreFilter.tsx#StoreFilter', 'apps/web/src/settings/sections/Stores.tsx#StoreList'], proof: "apps/web/src/settings/sections/Stores.test.tsx#the list shows each store's color, platform, data, currency and fees, and opens its page" }),
  store('name', { type: 'string', maxLength: 80, label: 'Name', help: "Agents see it in their store profile.", fill: 'chosen when the store is added', applies: 'new runs', consumers: ['packages/agents/src/prompt.ts#assemblePrompt'], proof: `${PROMPT}#Glow Haus Analytics Specialist: role → playbook → Shopify → beauty → profile → memory → date` }),
  store('platform', { type: 'string', enum: ['shopify', 'tiktok_shop', 'etsy', 'amazon', 'woocommerce', 'walmart'], label: 'Platform', help: 'Where the store sells.', fill: 'chosen when the store is added', applies: 'new runs', consumers: ['packages/agents/src/prompt.ts#storeWrites'], proof: `${PROMPT}#a connected store is told what the app can change there on approval` }),
  store('niche', { type: 'string', enum: ['beauty', 'pet', 'tech', 'fitness', 'home', 'fashion', 'kids', 'outdoor', 'other'], label: 'Niche', help: "Picks the agents' niche pack.", fill: 'chosen when the store is added', applies: 'job', consumers: ['packages/agents/src/prompt.ts#assemblePrompt'], proof: `${PROMPT}#Peak Fit Ad Strategist gets TikTok Shop + fitness, live data` }),
  store('nicheDetail', { type: 'string', maxLength: 120, nullable: true, label: 'Sub-niche', help: 'What the store sells, in a few words.', default: null, applies: 'new runs', consumers: ['packages/agents/src/prompt.ts#storeProfile'], proof: `${PROMPT}#custom niche: no niche pack, the sub-niche still reaches the profile` }),
  store('currency', { type: 'string', pattern: '^[A-Z]{3}$', label: 'Selling currency', help: 'Set by the platform on every sync for a connected store.', default: 'USD', applies: 'job', consumers: ['apps/server/src/connectors/common.ts#setStoreCurrency'], proof: `${COMMON}#a real store's currency changing closes requests priced in the old one and drops its budgets until the ad sync re-reads them` }),
  store('timezone', { type: 'string', maxLength: 64, label: 'Business timezone', help: "The store's reporting days. On a demo store it applies once the store goes live.", fill: "this computer's zone when the store is added", applies: 'now', consumers: ['apps/server/src/connectors/common.ts#setStoreTimezone'], proof: `${COMMON}#a real store's new timezone re-dates its orders, rebuilds both calendars' days and has Amazon re-read its daily totals` }),
  store('feePercent', { type: 'number', min: 0, max: 50, label: 'Fees, % of revenue', help: 'Platform and payment fees, taken off profit for all orders, past ones included.', default: 0, applies: 'now', consumers: ['apps/server/src/analytics.ts#loadRows'], proof: "apps/server/src/stores.test.ts#the owner's fee estimate is saved on the store and comes off its profit" }),
  store('feePerOrder', { type: 'number', min: 0, max: 100, label: 'Fee per order', help: 'In the store currency, taken off profit for all orders, past ones included.', default: 0, applies: 'now', consumers: ['apps/server/src/analytics.ts#loadRows'], proof: "apps/server/src/stores.test.ts#the owner's fee estimate is saved on the store and comes off its profit" }),

  // Knowledge research controls (KB General and each store are separate documents, never merged: decision 4).
  kb('autonomous', { type: 'boolean', label: 'Self-directed research', help: "Agents research gaps on their own, within the budgets below. A store's agents only.", default: false, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#begin'], proof: `${AUTONOMY}#never on the demo engine, and never for a store that has it off` }),
  kb('roles', { type: 'map', keys: ['ad_strategist', 'product_hunter', 'store_developer', 'creative_studio', 'market_analyst', 'copywriter', 'email_sms', 'operations'], label: 'Roles that research', help: 'Each with the top-level categories it answers for; none set means its usual areas.', default: {}, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#responsible'], proof: `${AUTONOMY}#a role only answers for its categories: none set means its usual areas; off, it doesn't research` }),
  kb('triggers', { type: 'list', maxItems: 4, enum: ['conflict', 'anomaly', 'gap', 'stale'], label: 'What starts research', help: 'Contradictions, performance anomalies, knowledge gaps and stale cards.', default: ['conflict', 'anomaly', 'gap', 'stale'], applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#candidates'], proof: `${AUTONOMY}#stale cards, contradictions and performance anomalies, each when its trigger is on` }),
  kb('taskBudgetUsd', { type: 'number', min: 0.25, max: 5, label: 'Budget per task', help: 'Most one self-directed task may spend.', default: 1, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#begin'], proof: `${AUTONOMY}#a gap the responsible role covers starts a task on its own, at the workspace depth and task budget` }),
  kb('dailyBudgetUsd', { type: 'number', min: 0.25, max: 50, label: 'Budget in any 24 hours', help: 'What self-directed research may reserve in any 24 hours, pending approvals included. At least the task budget.', default: 3, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#reservedUsd'], proof: `${AUTONOMY}#the daily budget holds what the last 24 hours reserved, recommendations waiting included` }),
  kb('depth', { type: 'string', enum: ['quick', 'standard', 'deep'], label: 'Research depth', help: 'How many sources a task reads: 3, 5 or 8.', default: 'standard', applies: 'next hourly pass', consumers: ['apps/server/src/kb/autonomy.ts#begin'], proof: `${AUTONOMY}#a gap the responsible role covers starts a task on its own, at the workspace depth and task budget` }),
  kb('approval', { type: 'boolean', label: 'Ask before each task', help: 'Each self-directed task waits in "Agents recommend" for your approval.', default: true, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/autonomy.ts#begin'], proof: `${AUTONOMY}#with approval required, it waits in Agents recommend; approved, it runs as self-directed research` }),
  kb('review', { type: 'boolean', label: 'Review research findings', help: 'Findings start Unreviewed; off, they start accepted.', default: true, applies: 'new runs', safeguard: true, consumers: ['packages/agents/src/kb-research.ts#storing'], proof: 'apps/server/src/kb/research.test.ts#discovery prefers the trusted domains and skips the blocked ones, which the reader refuses too; with review off, cards start accepted' }),
  kb('trustedDomains', { type: 'list', maxItems: 50, pattern: DOMAIN, label: 'Trusted sites', help: 'Preferred in research prompts. Never overrides blocked domains, review or approvals.', default: [], applies: 'new runs', safeguard: true, consumers: ['packages/agents/src/kb-research.ts#discovering'], proof: 'apps/server/src/kb/research.test.ts#discovery prefers the trusted domains and skips the blocked ones, which the reader refuses too; with review off, cards start accepted' }),
  kb('blockedDomains', { type: 'list', maxItems: 50, pattern: DOMAIN, label: 'Blocked sites', help: 'Never read. A domain blocks its subdomains.', default: [], applies: 'new runs', safeguard: true, consumers: ['packages/agents/src/kb-research.ts#retrieving'], proof: 'apps/server/src/kb/research.test.ts#discovery prefers the trusted domains and skips the blocked ones, which the reader refuses too; with review off, cards start accepted' }),
  kb('freshDays', { type: 'map', min: 7, max: 730, integer: true, label: 'Days a card stays fresh', help: 'By top-level category; one not set keeps its area’s usual age.', default: {}, applies: 'next hourly pass', consumers: ['packages/agents/src/kb.ts#freshness'], proof: 'apps/server/src/kb/maintenance.test.ts#each top-level category\'s usual age by its area; the owner\'s choice for one; subcategories follow their top' }),
  kb('retentionDays', { type: 'number', min: 30, max: 3650, integer: true, nullable: true, label: 'Keep page text and research logs', help: 'Days fetched page text and finished research logs are kept; sources, tasks and reports stay.', default: null, applies: 'next hourly pass', safeguard: true, consumers: ['apps/server/src/kb/maintenance.ts#trim'], proof: "apps/server/src/kb/maintenance.test.ts#trims fetched text and finished research's logs past the workspace's age, and keeps the rest" }),
  // Not a KB control: it inherits (decision 13), read at each automatic save by its callers, never in captureFinding.
  { id: 'knowledge.autoSave', section: 'knowledge', type: 'boolean', label: 'Save findings automatically', help: "Findings an agent saves in a conversation set to save Automatically, and the claims a Product Research report files, saved unreviewed. Off: those conversations ask you, and reports file no cards. Your own saves, measured results, Knowledge research results and promotions aren't affected.", scopes: ['workspace', 'store'], inherits: 'workspace', default: true, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: true, consumers: ['packages/agents/src/tools.ts#save_finding', 'apps/server/src/product-research/reports.ts#captureFindings'], proof: `${AUTOSAVE}#a conversation saving Automatically files an unreviewed card with its run, agent and sources; with Automatic saving off, its next save asks and the cards stay` },

  // Product Research store profile (ST-27): each one is in the next research task's message. priceMin isn't offered: no fit
  // rule reads a minimum (decision 11 uses the band's maximum), so it has no consumer.
  pr('audience', { type: 'string', maxLength: 500, nullable: true, label: 'Audience', help: 'Who the store sells to, for research briefs.', default: null, applies: 'new runs', consumers: ['apps/server/src/product-research/pipeline.ts#getBrief', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/pipeline.test.ts#the test brief: prefilled only from stored data (empty fields stay empty) until the owner saves it' }),
  pr('priceMax', { type: 'number', min: 0, max: 1e9, integer: true, nullable: true, label: 'Highest cost + shipping', help: "The most a product may cost you, shipped, in the store's currency. Above it, fit is Weak.", default: null, applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#fitFor', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/evaluate.test.ts#the profile API: defaults from the store, validation, and a save that re-evaluates fit' }),
  pr('shipTo', { type: 'string', pattern: '^[A-Za-z]{2}$', nullable: true, label: 'Ship to', help: "The country you ship to; empty uses the store currency's main country.", default: null, applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#evaluate', 'apps/server/src/product-research/economics.ts#derived', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/evaluate.test.ts#Rank: fulfillment and cost + ship per store ship-to and currency, a ship-to change re-ranks, and the 7-day decay' }),
  pr('warehouses', { type: 'list', maxItems: 50, pattern: '^[A-Za-z]{2}$', label: 'Preferred ships-from', help: 'Two-letter country codes, like US or CN. Shipping from none of them makes fit Medium.', default: [], applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#fitFor', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/evaluate.test.ts#the profile API: defaults from the store, validation, and a save that re-evaluates fit' }),
  pr('maxDeliveryDays', { type: 'number', min: 1, max: 120, integer: true, nullable: true, label: 'Longest delivery', help: 'In days. Slower makes fit Medium.', default: null, applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#fitFor', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/evaluate.test.ts#the profile API: defaults from the store, validation, and a save that re-evaluates fit' }),
  pr('includeCategories', { type: 'list', maxItems: 50, maxLength: 80, label: 'Include categories', help: 'Categories in scope besides the niche.', default: [], applies: 'next daily plan', consumers: ['apps/server/src/product-research/evaluate.ts#inScope', 'apps/server/src/product-research/profile.ts#discoveryQueries', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/discovery.test.ts#scopes: a store sees shared rows and its own, never another store\'s; All stores names a private row\'s store' }),
  pr('keywords', { type: 'list', maxItems: 50, maxLength: 80, label: 'Keywords', help: 'Searched on CJ besides the niche.', default: [], applies: 'next daily plan', consumers: ['apps/server/src/product-research/profile.ts#discoveryQueries', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: 'apps/server/src/product-research/sources/cj.test.ts#discovery: a job pages through CJ for each query and stores listings with what CJ said, as CJ said it' }),
  pr('avoidCategories', { type: 'list', maxItems: 50, maxLength: 80, label: 'Avoided categories', help: 'Flagged, never hidden; a flag makes fit Weak until you dismiss it.', default: [], applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#evaluate', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: `${PRPROFILE}#avoided categories and terms flag the store's products and make their fit Weak, never hiding them; only that store's` }),
  pr('avoidTerms', { type: 'list', maxItems: 50, maxLength: 80, label: 'Avoided terms', help: 'Words in a title. Flagged, never hidden.', default: [], applies: 'now', consumers: ['apps/server/src/product-research/evaluate.ts#evaluate', 'apps/server/src/product-research/tasks.ts#taskMessage'], proof: `${PRPROFILE}#avoided categories and terms flag the store's products and make their fit Weak, never hiding them; only that store's` }),
  // Default assumptions (ST-28): a product's economics read them where it has no figure of its own; saved comparisons keep theirs.
  ...([
    ['discountPct', 'Discount', 'Off the selling price, on average. Empty: no discount.'],
    ['returnRatePct', 'Return rate', 'Of orders returned. Empty: no returns.'],
    ['refundPct', 'Refund on a return', 'Of the order value refunded. Empty: a full refund.'],
  ] as const).map(([k, label, help]) =>
    pr(k, { type: 'number', min: 0, max: 100, nullable: true, label, help, default: null, applies: 'now', consumers: ['apps/server/src/product-research/economics.ts#derived'], proof: `${PRASSUME}#the store's default assumptions read as Your assumption; null keeps today's; a product's own figure wins; a missing cost stays Unknown` }),
  ),

  // Pause new automation (ST-29, decision 14): read at each automatic start, the sites in config/automation.ts RUN_STARTS.
  { id: 'automation.paused', section: 'automation', type: 'boolean', label: 'Pause new automation', help: "Stops new work the app starts by itself: scheduled and metric rules, self-directed and scheduled research, Knowledge promotion drafts, re-running what a restart interrupted, and go-live drafting. Your conversations, teams, missions under way, syncs and backups go on. Slots missed while paused are skipped, not caught up.", scopes: ['workspace'], default: false, owner: 'apps/server/src/config/write.ts#writeConfig', applies: 'now', export: false, consumers: ['apps/server/src/automations.ts#startScheduler', 'apps/server/src/kb/autonomy.ts#autonomousResearch', 'apps/server/src/kb/promote.ts#proposeKbPromotions', 'packages/agents/src/runs.ts#createRunManager', 'apps/server/src/routes/agents.ts#activateConnectedStores'], proof: `${PAUSE}#while paused a due slot doesn't fire, and on resume the missed slot is skipped, not caught up` },

  // Locked policies (decision 4): shown with a lock, never written by any scope, import or API call.
  { id: 'policy.approvals', section: 'automation', type: 'boolean', label: 'Spending, publishing and live-store edits', help: 'Always ask you first. The one exception is autopilot for ad budget changes and pausing campaigns, within each store\'s daily cap.', scopes: ['workspace'], locked: true, default: true, owner: 'packages/agents/src/tools.ts#requestApproval', applies: 'now', consumers: ['packages/agents/src/tools.ts#requestApproval'] },
  { id: 'policy.storeIsolation', section: 'automation', type: 'boolean', label: 'Store isolation', help: "A store's agents see and change only that store.", scopes: ['workspace'], locked: true, default: true, owner: 'apps/server/src/routes/agents-scope.ts#wrongStore', applies: 'now', consumers: ['apps/server/src/routes/agents-scope.ts#wrongStore'] },
  { id: 'policy.secretsWriteOnly', section: 'integrations', type: 'boolean', label: 'Credentials are write-only', help: 'Encrypted on this computer and never sent back to the screen.', scopes: ['workspace'], locked: true, default: true, owner: 'apps/server/src/integrations.ts#secretsOf', applies: 'now', consumers: ['apps/server/src/integrations.ts#secretsOf'] },
];
