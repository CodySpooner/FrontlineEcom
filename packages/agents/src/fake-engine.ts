import { AGENT_ROLES, type AgentEvent } from '@frontline/shared';
import type { Engine, RunInput } from './engine';
import { REFLECTION_PROMPT } from './memory';
import type { ToolName } from './roles';
import { callTool, cash, channel, toolsFor } from './tools';

/** An event to emit, or a real call to one of the role's tools (needs `env`). */
export type FakeStep = AgentEvent | { call: ToolName; input?: Record<string, unknown> };
export type FakeScript = (input: RunInput) => FakeStep[];

/**
 * What each role does on a demo run: one real action on the store's data, so its screens (Store Builder, issue queue,
 * creatives, flows) fill up without spending Claude usage. Only the Creative Studio's waits for an approval.
 */
// ponytail: templated content from the store's own rows; the Claude engine does the real thinking.
const STORE_PAGES = [
  {
    match: /\bFAQ\b/i, title: 'FAQ',
    html: '<h2>Frequently asked questions</h2><h3>When will my order ship?</h3><p>Orders ship in 1-2 business days and arrive in 3-5.</p><h3>Can I return it?</h3><p>Yes: 30-day returns, no questions asked.</p><h3>How do I pick a size?</h3><p>Check the size chart on each product page, or reply to your order email and we will help.</p>',
  },
  {
    match: /\b(landing|promo)\b/i, title: "This week's offer",
    html: '<h2>This week only: 20% off everything</h2><p>Our best sellers, at the lowest price of the season.</p><ul><li>Free shipping over $50</li><li>30-day returns</li><li>Loved by thousands of customers</li></ul><p><a href="/collections/all">Shop the sale</a></p>',
  },
];

const coreFlows = (store: string) => [
  {
    match: /welcome/i, name: 'Welcome series', trigger: 'Joined the email or SMS list; exclude anyone who already ordered',
    messages: [
      { delayHours: 0, channel: 'email', subject: `Welcome to ${store}`, preview: 'Your first-order code is inside', body: 'Who we are in two lines, the best sellers, and a first-order code.' },
      { delayHours: 48, channel: 'email', subject: 'Why customers pick us', preview: 'Reviews from real buyers', body: 'Three short reviews, shipping and returns, the code again.' },
    ],
  },
  {
    match: /abandon|cart|checkout/i, name: 'Checkout abandonment', trigger: 'Checkout started, no order within 1 hour; exclude anyone who bought in the last 30 days',
    messages: [
      { delayHours: 1, channel: 'email', subject: 'You left something behind', preview: 'Your cart is saved', body: 'The product, 3 short reviews, shipping times, one-click return to checkout.' },
      { delayHours: 24, channel: 'sms', body: `${store}: your cart is saved for 24h. Reply STOP to opt out.` },
    ],
  },
  {
    match: /post-purchase|after (an |the )?order|thank/i, name: 'Post-purchase', trigger: 'Order placed; exclude refunded orders',
    messages: [
      { delayHours: 1, channel: 'email', subject: 'Thanks for your order', preview: 'Here is what happens next', body: 'Shipping timeline, how to use it, who to contact.' },
      { delayHours: 24 * 14, channel: 'email', subject: 'How is it going?', preview: 'A quick review helps a lot', body: 'Ask for a review, then show what pairs well with it.' },
    ],
  },
  {
    match: /win-?back|lapsed|inactive/i, name: 'Win-back', trigger: 'No order in 90 days since the last one; exclude unsubscribed',
    messages: [
      { delayHours: 0, channel: 'email', subject: 'We miss you', preview: 'Something new since your last order', body: 'What is new, the best seller, a comeback code.' },
      { delayHours: 72, channel: 'sms', body: `${store}: your comeback code ends tonight. Reply STOP to opt out.` },
    ],
  },
];

function demoWork(input: RunInput): FakeStep[] {
  const db = input.env!.db;
  const storeId = input.store.id;
  const product = (id?: string) =>
    db.prepare(`SELECT id, title, price FROM products WHERE store_id = ? AND (id = ? OR ? IS NULL) ORDER BY status = 'active' DESC, price DESC LIMIT 1`).get(storeId, id ?? null, id ?? null);
  switch (input.agent.role) {
    case 'ad_strategist':
      return [{ call: 'review_campaigns', input: { days: 7 } }];
    case 'product_hunter': {
      // A bundle of the niche's most trending feed item not bundled yet, so AI Research shows a new scored card.
      const top = db
        .prepare(
          `SELECT * FROM research_products r WHERE niche = ? AND title NOT LIKE '% bundle'
             AND NOT EXISTS (SELECT 1 FROM research_products b WHERE b.title = r.title || ' bundle') ORDER BY trend DESC LIMIT 1`,
        )
        .get(input.store.niche);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const find: FakeStep[] = top
        ? [{
            call: 'record_product_find',
            input: {
              title: `${String(top.title).slice(0, 110)} bundle`, category: String(top.category), source: String(top.source),
              cost: r2(Number(top.cost) * 1.8), price: r2(Number(top.price) * 1.7), compareAt: r2(Number(top.price) * 2.4),
              trend: Number(top.trend), competition: Math.max(0, Number(top.competition) - 10), shippingDays: Number(top.shipping_days),
              ...(top.image ? { image: String(top.image) } : {}),
            },
          }]
        : [];
      return [{ call: 'research_feed', input: { limit: 5 } }, ...find];
    }
    case 'operations': {
      // "Hand to Operations" on one order (Orders page): flag that order with what the page saw. A refunded one is
      // 'other', since refunds close the other kinds on their own.
      const asked = input.task.match(/^Order (\S+) \([^)]*\): ([^.]+)\./);
      if (asked) {
        const [, orderId, detail] = asked;
        const kind = /refunded/i.test(detail!) ? 'other' : /tracking/i.test(detail!) ? 'supplier' : 'late';
        const suggestedAction = {
          other: 'Cancel it with the supplier before it ships.',
          supplier: 'Ask the supplier for the tracking number and add it to the order.',
          late: 'Ask the supplier for a ship date today and tell the customer.',
        }[kind];
        return [{ call: 'flag_order_issue', input: { orderId, kind, severity: kind === 'late' ? 'high' : 'medium', note: `${detail}.`, suggestedAction } }];
      }
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
      // A store page the Store Builder asks for (its FAQ / promo landing ideas), unless the task is about a product page.
      const page = !/product page/i.test(input.task) && STORE_PAGES.find((p) => p.match.test(input.task));
      if (page) return [{ call: 'draft_page', input: { kind: 'page', title: page.title, html: page.html, notes: 'Demo draft: the questions and offer customers ask about most, short answers up top.' } }];
      // Every product the task names ("New draft product(s) just added…"), else the top one.
      const named = [...input.task.matchAll(/\(productId ([^)]+)\)/g)].map((m) => product(m[1]));
      const todo = (named.length ? named : [product()]).filter(
        (p) => p && !db.prepare('SELECT 1 FROM page_drafts WHERE store_id = ? AND product_id = ? AND published_at IS NULL').get(storeId, String(p.id)),
      );
      if (!todo.length) return [{ call: 'list_products' }];
      return todo.map((p) => ({
        call: 'draft_page',
        input: {
          kind: 'product', productId: String(p!.id), title: String(p!.title), notes: 'Demo draft: benefit-first layout with shipping and returns up top.',
          html: `<h2>${p!.title}</h2><p>Why customers pick it, in one line.</p><ul><li>Benefit one, with the spec behind it</li><li>Benefit two</li><li>What's in the box</li></ul><p>Ships in 3-5 days. 30-day returns.</p>`,
        },
      }));
    }
    case 'copywriter': {
      // The brief's offer ("20% off") leads; otherwise a different hook each time, so Ad Copy doesn't repeat itself.
      const p = product();
      const offer = input.task.match(/\b\d+% off\b/i)?.[0];
      const made = Number(db.prepare(`SELECT count(*) AS n FROM creatives WHERE store_id = ? AND kind = 'copy'`).get(storeId)?.n);
      const hook = ['done right', 'the one everyone is switching to', 'made for your routine'][made % 3];
      return p
        ? [{
            call: 'create_creative',
            input: {
              kind: 'copy', headline: (offer ? `${p.title}: ${offer} this week` : `${p.title}, ${hook}`).slice(0, 80), cta: 'Shop now',
              primaryText: `Meet ${p.title}: the upgrade your routine was missing. Now ${cash(Number(p.price), input.store.currency)}${offer ? `, ${offer} for a limited time` : ''}.`,
            },
          }]
        : [];
    }
    case 'market_analyst': {
      // Ask AI (Ctrl+K) lands here: read what the question is about, so the demo answer shows the data behind it.
      const q = input.task.toLowerCase();
      if (/competitor|rival/.test(q)) return [{ call: 'list_competitors' }];
      if (/\bads?\b|campaign|roas|spend|budget/.test(q)) return [{ call: 'list_campaigns', input: { days: 7 } }];
      if (/order|ship|fulfil|refund/.test(q)) return [{ call: 'list_orders', input: { days: 7, limit: 20 } }];
      if (/product|sell|seller|price|catalog|stock/.test(q)) return [{ call: 'list_products' }];
      return [{ call: 'metrics_timeseries', input: { days: 7 } }];
    }
    case 'creative_studio': {
      // Only the owner starts it (no scheduled jobs), so its demo asks first like a real run: approve → a demo render.
      const p = product();
      // The first "<kind> ad" in the task: the tab's own or a card's ("Add on-screen captions to this video ad ...").
      const kind = input.task.match(/\b(UGC|video|image)\b[^.]*? ad\b/i)?.[1]?.toLowerCase() ?? 'image';
      const brief = input.task.match(/brief: ([\s\S]+)/i)?.[1]?.trim() ?? input.task;
      // Ad Variations asks for N with different hooks (each its own request, like a real run); at most 3.
      const hooks = ['see the difference', 'what everyone is switching to', `now ${cash(Number(p?.price), input.store.currency)}`];
      const n = Math.min(3, Number(input.task.match(/\bMake (\d+) variations\b/i)?.[1] ?? 1));
      return p
        ? hooks.slice(0, n).map((hook) => ({
            call: 'create_creative',
            input: {
              kind, aspect: input.task.match(/\b(1:1|4:5|9:16|16:9)\b/)?.[1] ?? '1:1', prompt: brief.slice(0, 1000), cta: 'Shop now',
              headline: `${p.title}: ${hook}`.slice(0, 80), primaryText: `${p.title}, now ${cash(Number(p.price), input.store.currency)}. Tap to see it in action.`,
            },
          }))
        : [];
    }
    case 'email_sms': {
      // The flow the task names, else the first of the four core flows the store's library lacks (the monthly check's order).
      const flows = coreFlows(input.store.name);
      const have = new Set(db.prepare('SELECT name FROM flow_drafts WHERE store_id = ?').all(storeId).map((r) => String(r.name)));
      const flow = flows.find((f) => f.match.test(input.task)) ?? flows.find((f) => !have.has(f.name)) ?? flows[1]!;
      const { match: _, ...draft } = flow;
      return [{ call: 'draft_flow', input: { ...draft, notes: 'Demo flow: a standard starting point; size it with the real numbers before setting it up.' } }];
    }
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
  // Quotes the task's first clause: scheduled jobs carry a paragraph of instructions after "Daily briefing:".
  const task = input.task.split(/[:\n]|\.(?=\s|$)/)[0]!.trim().slice(0, 80);
  let reply = `${AGENT_ROLES[input.agent.role].name} for ${input.store.name}: on it — "${task}".`;
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
