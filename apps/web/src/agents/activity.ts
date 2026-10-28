import type { AgentEvent, AgentRunDetail } from '@frontline/shared';
import { toolName } from '../lib/transcript';

// A reply's activity block: one plain sentence per real transcript event, never the model's reasoning and never
// invented progress. A tool missing from the phrase map shows its name.

export interface Step {
  icon: 'done' | 'running' | 'warning' | 'failed';
  text: string;
}

type Input = Record<string, unknown>;
const host = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return 'a web page';
  }
};
const quoted = (v: unknown) => (typeof v === 'string' && v.trim() ? ` for "${v.trim().slice(0, 60)}"` : '');

export const PHRASES: Record<string, string | ((input: Input) => string)> = {
  store_summary: "Read the store's last 30 days",
  compare_stores: 'Compared this store with your other stores',
  metrics_timeseries: (i) => `Read ${Number(i.days) || 30} days of store metrics`,
  list_products: 'Read the product catalog',
  list_orders: 'Read recent orders',
  list_campaigns: 'Read the ad campaigns',
  review_campaigns: "Reviewed the campaigns' results",
  list_competitors: 'Read the tracked competitors',
  track_competitor: 'Added a competitor to track',
  record_product_find: 'Recorded a product find',
  search_suppliers: (i) => `Searched suppliers${quoted(i.query)}`,
  research_feed: 'Read the research feed',
  squad_log: "Read the squad's recent work",
  list_creatives: 'Read the creative library',
  create_creative: 'Drafted a creative',
  list_flows: 'Read the email and SMS flows',
  draft_flow: 'Drafted an email or SMS flow',
  list_order_issues: 'Read the open order issues',
  flag_order_issue: 'Flagged an order issue',
  list_themes: "Read the store's themes",
  read_theme_files: 'Read theme files',
  draft_theme_change: 'Drafted a theme change',
  draft_page: 'Drafted a page',
  publish_page: 'Asked to publish a page',
  promote_niche_learning: 'Proposed a niche learning',
  assign_task: 'Assigned a task to a squadmate',
  propose_ad_change: 'Proposed an ad change',
  propose_price_change: 'Proposed a price change',
  search_memory: (i) => `Searched store memory${quoted(i.query)}`,
  write_memory: 'Saved a note to store memory',
  request_approval: 'Asked for your approval',
  search_knowledge: (i) => `Searched the knowledge base${quoted(i.query)}`,
  recommend_research: 'Recommended research',
  propose_general: 'Proposed a General knowledge card',
  fetch_source: (i) => `Read ${host(i.url)}`,
  propose_card: 'Proposed a knowledge card',
  add_evidence: 'Added evidence to a knowledge card',
  suggest_link: 'Suggested a link between knowledge cards',
  WebSearch: (i) => `Searched the web${quoted(i.query)}`,
  WebFetch: (i) => `Read ${host(i.url)}`,
};

const phrase = (name: string, input: unknown) => {
  const [tool, via] = toolName(name);
  const p = PHRASES[tool];
  const text = typeof p === 'function' ? p(input && typeof input === 'object' ? (input as Input) : {}) : (p ?? tool);
  return via ? `${text} (${via})` : text;
};

/** The steps, in order. A tool still waiting on its result is running; the approval wait is a warning. */
export function activitySteps(events: AgentEvent[]): Step[] {
  const steps: Step[] = [];
  const calls = new Map<string, Step>();
  for (const e of events) {
    if (e.type === 'tool_call') {
      const step: Step = { icon: 'running', text: phrase(e.name, e.input) };
      calls.set(e.id, step);
      steps.push(step);
    } else if (e.type === 'tool_result') {
      const step = calls.get(e.id);
      if (step) step.icon = e.isError ? 'failed' : 'done';
    } else if (e.type === 'approval_request') steps.push({ icon: 'warning', text: `Asked for your approval: ${e.approval.title}` });
    else if (e.type === 'memory_written') steps.push({ icon: 'done', text: `Saved to store memory: ${e.memory.text}` });
    else if (e.type === 'knowledge') steps.push({ icon: 'done', text: `Read ${e.cards.length} knowledge card${e.cards.length === 1 ? '' : 's'}: ${e.cards.map((c) => c.title).join('; ')}` });
    else if (e.type === 'notice') steps.push({ icon: 'warning', text: e.text });
    else if (e.type === 'error') steps.push({ icon: 'failed', text: e.message });
  }
  return steps;
}

/** "3m 12s", "45s". */
export function took(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/** The block's summary: "Worked for 3m 12s · 5 steps", or "Working · 2 steps" while it runs. */
export function activitySummary(run: Pick<AgentRunDetail, 'status' | 'startedAt' | 'endedAt' | 'createdAt'>, steps: number, now = Date.now()) {
  const n = `${steps} step${steps === 1 ? '' : 's'}`;
  if (run.status === 'queued' || run.status === 'running') return `Working · ${n}`;
  const start = Date.parse(run.startedAt ?? run.createdAt);
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return `Worked for ${took(end - start)} · ${n}`;
}
