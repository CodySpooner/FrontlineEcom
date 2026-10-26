import { AGENT_ROLES, type AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { REFLECTION_PROMPT } from './memory';
import type { ToolName } from './roles';
import { callTool, channel, toolsFor } from './tools';

/** An event to emit, or a real call to one of the role's tools (needs `env`). */
export type FakeStep = AgentEvent | { call: ToolName; input?: Record<string, unknown> };
export type FakeScript = (input: RunInput) => FakeStep[];

/**
 * What each role does on a demo run: one real action on the store's data that never waits for an approval, so its
 * screens (Store Builder, issue queue, creatives, flows) fill up without spending Claude usage.
 */
// ponytail: templated content from the store's own rows; the Claude engine does the real thinking.
function demoWork(input: RunInput): FakeStep[] {
  const db = input.env!.db;
  const storeId = input.store.id;
  const product = (id?: string) =>
    db.prepare(`SELECT id, title, price FROM products WHERE store_id = ? AND (id = ? OR ? IS NULL) ORDER BY status = 'active' DESC, price DESC LIMIT 1`).get(storeId, id ?? null, id ?? null);
  switch (input.agent.role) {
    case 'ad_strategist':
      return [{ call: 'review_campaigns', input: { days: 7 } }];
    case 'product_hunter':
      return [{ call: 'research_feed', input: { limit: 5 } }];
    case 'operations': {
      // The oldest late order not flagged before, so a resolved issue doesn't come back with the next daily check.
      const late = db
        .prepare(
          `SELECT id, local_date FROM orders o WHERE store_id = ? AND fulfillment_status = 'unfulfilled' AND local_date <= date('now', '-3 days')
             AND NOT EXISTS (SELECT 1 FROM order_issues i WHERE i.store_id = o.store_id AND i.order_id = o.id AND i.kind = 'late')
           ORDER BY local_date LIMIT 1`,
        )
        .get(storeId);
      const flag: FakeStep[] = late
        ? [{ call: 'flag_order_issue', input: { orderId: String(late.id), kind: 'late', severity: 'medium', note: `Unfulfilled since ${late.local_date}, past the 3-day handling promise.`, suggestedAction: 'Ask the supplier for tracking today.' } }]
        : [];
      return [{ call: 'list_orders', input: { days: 14, fulfillment: 'unfulfilled' } }, ...flag];
    }
    case 'store_developer': {
      const p = product(input.task.match(/\(productId ([^)]+)\)/)?.[1]);
      if (!p || db.prepare('SELECT 1 FROM page_drafts WHERE store_id = ? AND product_id = ? AND published_at IS NULL').get(storeId, String(p.id))) return [{ call: 'list_products' }];
      const html = `<h2>${p.title}</h2><p>Why customers pick it, in one line.</p><ul><li>Benefit one, with the spec behind it</li><li>Benefit two</li><li>What's in the box</li></ul><p>Ships in 3-5 days. 30-day returns.</p>`;
      return [{ call: 'draft_page', input: { kind: 'product', productId: String(p.id), title: String(p.title), html, notes: 'Demo draft: benefit-first layout with shipping and returns up top.' } }];
    }
    case 'copywriter': {
      const p = product();
      return p ? [{ call: 'create_creative', input: { kind: 'copy', headline: `${p.title}, done right`.slice(0, 80), primaryText: `Meet ${p.title}: the upgrade your routine was missing. Now $${p.price}.`, cta: 'Shop now' } }] : [];
    }
    case 'email_sms':
      return [{
        call: 'draft_flow',
        input: {
          name: 'Checkout abandonment',
          trigger: 'Checkout started, no order within 1 hour; exclude anyone who bought in the last 30 days',
          messages: [
            { delayHours: 1, channel: 'email', subject: 'You left something behind', preview: 'Your cart is saved', body: 'The product, 3 short reviews, shipping times, one-click return to checkout.' },
            { delayHours: 24, channel: 'sms', body: `${input.store.name}: your cart is saved for 24h. Reply STOP to opt out.` },
          ],
          notes: 'Demo flow: the standard 2-step recovery; size it with the real checkout numbers before setting it up.',
        },
      }];
    default:
      return [];
  }
}

/**
 * Deterministic default (demo mode): with tools available it does one real piece of the role's work (demoWork), reads
 * the store's last 30 days and quotes them. Reflection learns nothing, so demo runs don't fill store memory.
 */
export const echoScript: FakeScript = (input) => {
  const done: AgentEvent = { type: 'done', sessionId: input.resume ?? `fake-${input.agent.id}`, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  if (input.task === REFLECTION_PROMPT) return [{ type: 'text_delta', text: '[]' }, done];
  let reply = `${AGENT_ROLES[input.agent.role].name} for ${input.store.name}: on it — "${input.task}".`;
  const t = input.env?.summary(input.store.id, 30).totals;
  if (t) {
    const money = (n: number) => `${Math.round(n).toLocaleString('en-US')} ${input.store.currency}`;
    reply += ` Last 30 days: ${money(t.revenue)} revenue, ${money(t.profit)} profit, ROAS ${t.roas.toFixed(2)}, ${t.orders} orders. (Demo engine: switch to Claude for a real answer.)`;
  }
  return [...(t ? [...demoWork(input), { call: 'store_summary' as const, input: { range: 30 } }] : []), ...reply.split(/(?<= )/).map((text): AgentEvent => ({ type: 'text_delta', text })), done];
};

/** Scripted engine for tests and demo mode. Costs nothing, never touches the network, but runs tools for real. */
export function fakeEngine(script: FakeScript = echoScript): Engine {
  return async function* (input) {
    const events = channel<AgentEvent>();
    const ctx = input.env && { ...input.env, store: input.store, agent: input.agent, emit: events.push, signal: input.signal };
    const tools = toolsFor(input.agent.role);
    (async () => {
      let n = 0;
      for (const step of script(input)) {
        if (input.signal?.aborted) return;
        if (!('call' in step)) {
          events.push(step);
          continue;
        }
        const id = `fake-tool-${++n}`;
        const tool = tools.find((t) => t.name === step.call);
        events.push({ type: 'tool_call', id, name: step.call, input: step.input ?? {} });
        const result = tool && ctx ? await callTool(tool, step.input, ctx) : { output: `Tool ${step.call} is not available`, isError: true };
        events.push({ type: 'tool_result', id, ...result });
      }
    })().then(() => events.end(), events.end);
    yield* events.drain();
  };
}
