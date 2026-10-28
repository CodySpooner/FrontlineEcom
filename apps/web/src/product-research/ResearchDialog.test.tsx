// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { PrAgentRow, PrPreview, PrTask, Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { ResearchDialog, TEMPLATES } from './ResearchDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const store: Store = { id: 'paws', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', currency: 'USD', timezone: 'UTC', color: '#f00', connected: false };
const row = (o: Partial<PrAgentRow>): PrAgentRow => ({ type: 'product_hunter', name: 'Product Researcher', custom: false, runtime: 'demo', model: null, effort: null, budgetUsd: null, state: 'available', reason: null, busy: null, ...o });
const ROWS = [
  row({}),
  row({ type: 'scout', name: 'Travel gear scout', custom: true, runtime: 'claude', model: 'claude-opus-5-5', effort: 'high', budgetUsd: 0.6, state: 'busy', busy: { conversationId: 'c9', title: 'Research: Cat perch', queued: 1, slotsFull: true } }),
  row({ type: 'grumpy', name: 'Old scout', custom: true, state: 'not_ready', reason: 'Claude isn’t connected: set it up in Integrations.' }),
];
const preview = (o: Partial<PrPreview>): PrPreview => ({
  outcome: 'read', message: 'Read from the public page', url: 'https://shop.test/p/1?utm_source=x', canonicalUrl: 'https://shop.test/p/1', finalUrl: 'https://shop.test/p/1', host: 'shop.test', retrievedAt: '2026-10-28T10:41:00Z',
  listingId: 'l1', productId: 'p1', imageListing: null, title: 'Pet hair remover roller', price: { amount: 689, currency: 'USD' }, sku: null, brand: null, variants: ['Grey', 'Blue'], missing: ['Shipping not shown on the page'], candidates: [], ...o,
});
const task = { id: 't1', storeId: 'paws', productId: 'p1' } as PrTask;

function api({ page = preview({}), start = reply(task, 201) as Response } = {}) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const f = stubApi((url, init) => {
    const u = new URL(url, 'http://x');
    if (init?.method === 'POST') {
      posts.push({ url: `${u.pathname}${u.search}`, body: JSON.parse(String(init.body)) });
      return u.pathname === '/api/pr/preview' ? page : start.clone();
    }
    if (u.pathname === '/api/stores') return [store];
    if (u.pathname === '/api/pr/agents') return ROWS;
    if (u.pathname === '/api/pr/profile') return { storeId: 'paws', priceMin: 1500, priceMax: 4000, priceCurrency: 'USD' };
    if (u.pathname === '/api/kb/cards') return { items: [], total: 6 };
    if (u.pathname === '/api/caps') return [{ storeId: 'paws', agentCostPerDay: 5, adSpendChangePerDay: 100, higgsfieldCreditsPerDay: 200, autopilot: {} }];
    if (u.pathname === '/api/usage') return [{ storeId: 'paws', agentCostUsd: 0.8, adBudgetAddedUsd: 0, creditsUsed: 0 }];
    // Deploy (configure-only)
    if (u.pathname === '/api/agent-types') return [{ id: 'product_hunter', name: 'Product Researcher', description: 'Finds products.', baseRole: 'product_hunter', contract: { tools: [] } }, { id: 'scout', name: 'Travel gear scout', description: 'Scouts.', baseRole: 'product_hunter', contract: { tools: [] } }];
    if (u.pathname === '/api/presets') return [{ id: 'default:product_hunter', name: 'Find products', builtin: true, createdAt: '', config: { role: 'product_hunter' } }];
    if (u.pathname === '/api/tool-groups') return [{ id: 'data', name: 'Store data', access: 'read', tools: ['store_summary'] }];
    return undefined;
  });
  return { f, posts };
}
const started = vi.fn();
const open = (product?: { id: string; title: string }) =>
  renderApp(<ResearchDialog stores={[store]} store="paws" {...(product ? { product } : {})} onClose={() => undefined} onStarted={started} />, '/research?store=paws');
const dialog = () => screen.getByRole('dialog', { name: 'Research a Product' });
const startButton = () => within(dialog()).getByRole('button', { name: 'Start research' }) as HTMLButtonElement;

test('a read link, the store context, the agents with their state, a template, and Start sends exactly the draft', async () => {
  const { posts } = api();
  open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Product link' }), { target: { value: 'https://shop.test/p/1?utm_source=x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch preview' }));
  expect(await screen.findByText('Pet hair remover roller')).toBeTruthy();
  expect(screen.getByText(/^shop\.test · read from the public page .+ · page price \$6\.89 \(not verified\)$/)).toBeTruthy();
  expect(screen.getByText(/Variants on page: Grey, Blue\. Shipping not shown on the page\./)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Correct details' }));
  expect(screen.getByRole('group', { name: 'Your corrections and notes (owner-provided, kept apart from the page)' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Price' }), { target: { value: '5.99' } });

  expect(await screen.findByText("Brings Pawsome Gear's niche (pet), its $15.00–$40.00 price band and 6 knowledge cards (the store's and General).")).toBeTruthy();
  const agent = (name: RegExp) => screen.getByRole('radio', { name });
  expect(await screen.findByText('Working on “Research: Cat perch” · 1 queued in this conversation, then waits for a free store slot (2 per store)')).toBeTruthy();
  expect((agent(/^Old scout/) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('Claude isn’t connected: set it up in Integrations.')).toBeTruthy();
  fireEvent.click(agent(/^Product Researcher/));
  expect(screen.getByText('Demo runtime: its report will be a scripted example, not research.')).toBeTruthy();
  expect(screen.getByText(/Demo runtime: no AI cost\./)).toBeTruthy();
  fireEvent.click(agent(/^Travel gear scout/));
  expect(screen.getByText('Claude · Opus 5.5 · High')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Run separately' }));
  expect(screen.getByText(/Budget: up to \$0\.60 for this run · \$4\.20 left of today's \$5\.00 for Pawsome Gear's agents\./)).toBeTruthy();

  expect(startButton().disabled).toBe(true); // no instructions yet
  expect(screen.getByRole('link', { name: /4 Instructions/ }).getAttribute('aria-current')).toBe('step');
  expect(screen.getByRole('link', { name: /1 Product link/ }).textContent).toMatch(/^✓ .*\(done\)$/);
  fireEvent.click(screen.getByRole('button', { name: 'Supplier check only' }));
  const box = screen.getByRole('textbox', { name: 'Instructions' }) as HTMLTextAreaElement;
  expect(box.value).toBe(TEMPLATES[1]!.text);
  fireEvent.change(box, { target: { value: `${box.value}\n  And the CA delivery time.  ` } });
  fireEvent.click(startButton());
  await waitFor(() => expect(started).toHaveBeenCalledWith(task));
  const sent = posts.find((p) => p.url === '/api/pr/tasks?store=paws')!.body;
  expect(sent).toEqual({
    clientRequestId: expect.any(String),
    productId: 'p1',
    listingId: 'l1',
    url: 'https://shop.test/p/1?utm_source=x',
    preview: { title: 'Pet hair remover roller', price: { amount: 689, currency: 'USD' }, variants: ['Grey', 'Blue'] },
    owner: { price: { amount: 599, currency: 'USD' } },
    instructions: `${TEMPLATES[1]!.text}\n  And the CA delivery time.  `, // exactly what is in the box
    template: 'supplier_check',
    type: 'scout',
    mode: 'separate',
    conversationId: 'c9',
  });
  expect(JSON.parse(localStorage.getItem('fe.research.draft')!)).toMatchObject({ link: '', instructions: '', agent: null }); // a fresh draft
});

test("a page that wasn't read says so and takes the details by hand; the draft survives closing; a refusal shows its reason", async () => {
  const { posts } = api({ page: preview({ outcome: 'login', message: 'The page asks to sign in: enter the details by hand', url: 'https://shop.test/p/2', listingId: null, productId: null, title: null, price: null, variants: [], missing: [] }), start: reply({ ...task, status: 'not_started', error: 'Not started: This agent is offline. Redeploy it first.' }, 409) });
  const first = open();
  fireEvent.change(screen.getByRole('textbox', { name: 'Product link' }), { target: { value: 'https://shop.test/p/2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch preview' }));
  expect(await screen.findByText('The page asks to sign in: enter the details by hand')).toBeTruthy();
  expect(screen.queryByText(/read from the public page/)).toBeNull(); // never shown as an extraction
  fireEvent.click(screen.getByRole('button', { name: 'Enter the details by hand' }));
  fireEvent.click(await screen.findByRole('radio', { name: /^Product Researcher/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions' }), { target: { value: 'Is it worth a test?' } });
  expect(startButton().disabled).toBe(true); // a title is needed when nothing was read
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Collapsible dog bowl' } });

  first.unmount(); // closed, or the page reloaded
  open();
  expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Collapsible dog bowl');
  expect((screen.getByRole('textbox', { name: 'Product link' }) as HTMLInputElement).value).toBe('https://shop.test/p/2');
  expect((screen.getByRole('textbox', { name: 'Instructions' }) as HTMLTextAreaElement).value).toBe('Is it worth a test?');
  await waitFor(() => expect(startButton().disabled).toBe(false));
  fireEvent.click(startButton());
  expect((await screen.findByRole('alert')).textContent).toBe('Not started: This agent is offline. Redeploy it first.');
  expect(posts.find((p) => p.url === '/api/pr/tasks?store=paws')!.body).toEqual({
    clientRequestId: expect.any(String), url: 'https://shop.test/p/2', owner: { title: 'Collapsible dog bowl' }, instructions: 'Is it worth a test?', type: 'product_hunter', mode: 'new',
  });
  expect(started).not.toHaveBeenCalled();
});

test('from a product, with a new agent made in Deploy (configure-only): Start sends its config', async () => {
  started.mockClear();
  const { posts } = api();
  open({ id: 'p7', title: 'Dog travel bowl' });
  expect(await screen.findByText('Dog travel bowl')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: '+ Create new Product Research agent' }));
  const deploy = await screen.findByRole('dialog', { name: 'Deploy an agent' });
  expect(within(deploy).queryByRole('textbox', { name: 'Objective' })).toBeNull();
  const use = (await within(deploy).findByRole('button', { name: 'Use this agent' })) as HTMLButtonElement;
  await waitFor(() => expect(use.disabled).toBe(false));
  fireEvent.click(use);
  expect(await screen.findByText('New: Product Researcher')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions' }), { target: { value: 'Full check' } });
  fireEvent.click(startButton());
  await waitFor(() => expect(started).toHaveBeenCalled());
  const sent = posts.find((p) => p.url === '/api/pr/tasks?store=paws')!.body;
  expect(sent).toMatchObject({ productId: 'p7', type: 'product_hunter', mode: 'new', config: { runtime: 'demo', knowledge: ['store', 'general'], permissions: { saveFindings: 'off' } } });
  expect(sent).not.toHaveProperty('url');
  expect(posts.map((p) => p.url)).toEqual(['/api/pr/tasks?store=paws']); // Deploy created nothing
});
