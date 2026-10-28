// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { KbCard, KbCardBrief, KbEvidence, KbRevision } from '@frontline/shared';
import { Knowledge } from '../pages/Knowledge';
import { renderApp, stubApi } from '../test-utils';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const peak = { id: 'peak', name: 'Peak Fit', platform: 'shopify', niche: 'fitness', color: '#ff2a3a', currency: 'USD', timezone: 'UTC' };
const now = new Date().toISOString();
const brief = (id: string, storeId: string | null = 'peak', extra: Partial<KbCardBrief> = {}): KbCardBrief => ({
  id, storeId, categoryId: storeId ? 'peak-hooks' : 'general-psy', path: storeId ? ['Advertising', 'Hooks'] : ['Psychology'], type: 'strategy', stage: 'tested', status: 'active',
  title: `Card ${id}`, summary: `Summary ${id}`, tags: ['hooks'], authorId: 'peak:market_analyst', origin: 'research', pinned: false, blockedRoles: [], researchMarked: false,
  usedCount: 3, citedCount: 2, verifiedAt: now, createdAt: now, updatedAt: now, ...extra,
});
const full = (b: KbCardBrief): KbCard => ({ ...b, body: `Explanation ${b.id}`, relevance: `Matters ${b.id}`, application: `Agents use ${b.id}`, appliesTo: `Applies ${b.id}`, limits: `Limits ${b.id}` });
const source = { id: 'src1', url: 'https://ads.tiktok.com/creative', title: 'TikTok Creative Center', status: 'read' as const, reliability: 'platform_docs' as const, fetchedAt: '2026-10-20T10:00:00Z' };
const hidden = { ...source, id: 'src2', url: 'javascript:alert(1)', title: 'Odd page', reliability: 'publication' as const };
const evidence: KbEvidence[] = [
  { id: 'e1', cardId: 'a', kind: 'measured', text: 'EXP-14 · 2.9 vs 1.6 ROAS', metric: 'roas', value: 2.9, baseline: 1.6, testRef: 'EXP-14', authorId: 'owner', createdAt: now },
  { id: 'e2', cardId: 'a', kind: 'research', text: '3 of 4 sources agree', source, authorId: 'peak:market_analyst', createdAt: now },
  { id: 'e3', cardId: 'a', kind: 'conflict', text: 'One study found the opposite', authorId: 'app', createdAt: now },
  { id: 'e4', cardId: 'a', kind: 'observed', text: 'Seen on the old card', mergedFrom: 'z', authorId: 'owner', createdAt: now },
  { id: 'e5', cardId: 'a', kind: 'research', text: 'An odd page agrees', source: hidden, authorId: 'peak:market_analyst', createdAt: now },
];
const snap = (title: string) => ({ title, summary: '', body: '', relevance: '', application: '', appliesTo: '', limits: '', tags: [], categoryId: 'peak-hooks', type: 'strategy' as const, stage: 'tested' as const, status: 'active' as const });
const revisions: KbRevision[] = [
  { id: 2, cardId: 'a', actor: 'app', reason: 'Moved up: one measured test', createdAt: now, snapshot: snap('Card a') },
  { id: 1, cardId: 'a', actor: 'peak:market_analyst', reason: 'Created by research', createdAt: '2026-10-01T10:00:00Z', snapshot: snap('Old title') },
];
const links = [{ id: 'l1', storeId: 'peak', fromId: 'a', toId: 'b', type: 'supports', why: 'Both lifted CTR in the same test', status: 'confirmed', authorId: 'owner', createdAt: now }];

/** The board with `card` open; `cards` overrides the full cards by id, and `more` answers first. */
const open = (card: string, over: Record<string, Partial<KbCardBrief>> = {}, more: (url: string, init?: RequestInit) => unknown = () => undefined) => {
  const all = [brief('a'), brief('b'), brief('s', 'peak', { categoryId: 'peak-seo', path: ['SEO'] }), brief('g', null)].map((c) => ({ ...c, ...over[c.id] }));
  const fetch = stubApi((url, init) => {
    const answer = more(url, init);
    if (answer !== undefined) return answer;
    const m = init?.method;
    if (m === 'POST' && url === '/api/kb/cards') return new Response(JSON.stringify(full(brief('new1'))), { status: 201, headers: { 'content-type': 'application/json' } });
    if (m && m !== 'GET') return m === 'DELETE' || m === 'PUT' ? new Response(null, { status: 204 }) : full(all[0]!);
    if (url === '/api/stores') return [peak];
    const one = url.match(/^\/api\/kb\/cards\/(\w+)\?ws=all$/);
    if (one) return all.some((c) => c.id === one[1]) ? full(all.find((c) => c.id === one[1])!) : new Response('{"error":"card not found"}', { status: 404 });
    if (url.startsWith('/api/kb/cards/a/evidence')) return evidence;
    if (url.startsWith('/api/kb/cards/a/revisions')) return revisions;
    if (url.startsWith('/api/kb/cards?') && url.includes('status=merged')) return { items: [brief('z', 'peak', { status: 'merged', mergedInto: 'a', title: 'Card z' })], total: 1, offset: 0, limit: 1000 };
    if (url.startsWith('/api/kb/cards?')) return { items: all, total: all.length, offset: 0, limit: 1000 };
    if (url.startsWith('/api/kb/links?')) return links;
    if (url.startsWith('/api/kb/categories?')) return [{ id: 'peak-ads', storeId: 'peak', parentId: null, name: 'Advertising', position: 1, createdAt: now, cards: 0 }, { id: 'peak-hooks', storeId: 'peak', parentId: 'peak-ads', name: 'Hooks', position: 1, createdAt: now, cards: 2 }];
    if (url.startsWith('/api/kb/positions')) return {};
  });
  renderApp(<Knowledge />, `/knowledge?ws=peak${card ? `&card=${card}` : ''}`);
  return fetch;
};
/** The panel once its card has loaded. */
const panel = async () => {
  const p = await screen.findByRole('complementary', { name: 'Card details' });
  await within(p).findByRole('heading', { level: 2 });
  return p;
};
const where = () => screen.getByTestId('where').textContent;
const sent = (fetch: ReturnType<typeof stubApi>, method: string) => fetch.mock.calls.filter(([, i]) => i?.method === method).map(([u, i]) => [u, i?.body && JSON.parse(String(i.body))]);
const click = (name: string | RegExp, root?: HTMLElement) => fireEvent.click((root ? within(root) : screen).getByRole('button', { name }));

describe('Knowledge › details panel', () => {
  it("shows every field, the ladder, evidence with tags, sources and usage, beside a board that stays usable", async () => {
    open('a');
    const p = await panel();
    await within(p).findByText('Explanation a');
    expect(within(p).getByRole('heading', { name: 'Card a' })).toBeTruthy();
    expect(within(p).getByText('Peak Fit › Advertising › Hooks')).toBeTruthy();
    for (const t of ['Summary a', 'Matters a', 'Agents use a', 'Applies a', 'Limits a', '#hooks']) expect(within(p).getByText(t)).toBeTruthy();
    const ladder = within(p).getByRole('list', { name: 'Confidence' });
    expect(within(ladder).getByText('Tested').closest('li')!.getAttribute('aria-current')).toBe('step');
    const ev = await within(p).findByRole('list', { name: 'Evidence' });
    expect(within(ev).getAllByRole('listitem').map((li) => li.textContent!.slice(0, 8))).toEqual(['MEASURED', 'RESEARCH', 'CONFLICT', 'OBSERVED', 'RESEARCH']);
    expect(within(within(p).getByRole('list', { name: 'Sources' })).getByText('Odd page').closest('a')).toBeNull(); // only a web address is a link
    const src = within(p).getByRole('link', { name: /TikTok Creative Center/ });
    expect([src.getAttribute('href'), src.getAttribute('target'), src.getAttribute('rel')]).toEqual(['https://ads.tiktok.com/creative', '_blank', 'noopener noreferrer']);
    expect(within(p).getByText(/Platform docs · read · fetched/)).toBeTruthy();
    expect(within(p).getByText(/Used in 3 agent tasks · cited 2 times/)).toBeTruthy();
    // Non-modal: another card can still be picked on the board.
    fireEvent.pointerDown(document.querySelector('[data-kb-card="b"]')!, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(screen.getByRole('application'), { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
    expect(where()).toBe('/knowledge?ws=peak&card=b');
  });

  it('closes from its button and stays out of the way (inert) once closed', async () => {
    open('a');
    click('Close details', await panel());
    expect(where()).toBe('/knowledge?ws=peak');
    expect(screen.getByRole('complementary', { name: 'Card details', hidden: true }).closest('[inert]')).toBeTruthy();
  });

  it('connected cards: why linked, open the other card, and link to another', async () => {
    const fetch = open('a');
    const p = await panel();
    const conn = await within(p).findByRole('list', { name: 'Connected cards' });
    click('Why linked', conn);
    expect(within(p).getByText('Both lifted CTR in the same test')).toBeTruthy();
    click('Link to…', p);
    fireEvent.change(within(p).getByRole('searchbox', { name: 'Find a card' }), { target: { value: 'card s' } });
    click('Card s', p);
    fireEvent.change(within(p).getByRole('combobox', { name: 'Relationship' }), { target: { value: 'contradicts' } });
    fireEvent.change(within(p).getByRole('textbox', { name: 'Why are they linked?' }), { target: { value: 'Opposite claims' } });
    click('Add link', p);
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toEqual([['/api/kb/links', { ws: 'peak', from: 'a', to: 's', type: 'contradicts', why: 'Opposite claims' }]]));
    click('Card b', conn);
    expect(where()).toBe('/knowledge?ws=peak&card=b');
  });

  it('manual controls write to the card in its own workspace', async () => {
    const fetch = open('a');
    const p = await panel();
    await within(p).findByText('Explanation a');
    for (const b of ['Pin card', 'Mark for research', 'Block from agents', 'Archive', 'Reject']) click(b, p);
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toHaveLength(5));
    expect(sent(fetch, 'PATCH')).toEqual([
      ['/api/kb/cards/a?ws=peak', { pinned: true }],
      ['/api/kb/cards/a?ws=peak', { researchMarked: true }],
      ['/api/kb/cards/a?ws=peak', { blockedRoles: ['*'] }],
      ['/api/kb/cards/a?ws=peak', { status: 'archived' }],
      ['/api/kb/cards/a?ws=peak', { status: 'rejected' }],
    ]);
  });

  it.each([
    ['proposed', 'Accept', { status: 'active' }],
    ['archived', 'Unarchive', { status: 'active' }],
    ['rejected', 'Unreject', { status: 'active' }],
  ] as const)('a %s card offers %s', async (status, button, body) => {
    const fetch = open('a', { a: { status } });
    click(button, await panel());
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toEqual([['/api/kb/cards/a?ws=peak', body]]));
  });

  it('unblocks, unpins and unmarks; a General card writes to General', async () => {
    const fetch = open('g', { g: { blockedRoles: ['*'], pinned: true, researchMarked: true } });
    const p = await panel();
    for (const b of ['Unblock', 'Unpin card', 'Unmark for research']) click(b, p);
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toHaveLength(3));
    expect(sent(fetch, 'PATCH')).toEqual([
      ['/api/kb/cards/g?ws=general', { blockedRoles: [] }],
      ['/api/kb/cards/g?ws=general', { pinned: false }],
      ['/api/kb/cards/g?ws=general', { researchMarked: false }],
    ]);
  });

  it('merges a duplicate from the same workspace in, and detaches a merged card back out (evidence or not)', async () => {
    const fetch = open('a');
    const p = await panel();
    click('Merge a duplicate…', p);
    fireEvent.change(within(p).getByRole('searchbox', { name: 'Find a card' }), { target: { value: 'card' } });
    expect(within(p).queryByRole('button', { name: 'Card g' })).toBeNull(); // General: another workspace
    fireEvent.click(within(p).getByRole('button', { name: 'Card b', pressed: false })); // the picker's, not the connected row's
    click('Merge into this card', p);
    click('Detach', await within(p).findByRole('list', { name: 'Merged in' }));
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toHaveLength(2));
    expect(sent(fetch, 'POST')).toEqual([
      ['/api/kb/cards/a/merge?ws=peak', { from: 'b' }],
      ['/api/kb/cards/a/detach?ws=peak', { from: 'z' }],
    ]);
  });

  it('lists revisions newest first and restores an older one', async () => {
    const fetch = open('a');
    const hist = await within(await panel()).findByRole('list', { name: 'History' });
    const rows = within(hist).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Moved up: one measured test'), expect.stringContaining('Created by research')]);
    expect(within(rows[0]!).queryByRole('button', { name: 'Restore' })).toBeNull(); // the current one
    click('Restore', rows[1]!);
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toEqual([['/api/kb/cards/a/revisions/1/restore?ws=peak', undefined]]));
  });

  it('edits inline, sending only what changed with the reason', async () => {
    const fetch = open('a');
    const p = await panel();
    await within(p).findByText('Explanation a');
    click('Edit card', p);
    fireEvent.change(within(p).getByRole('textbox', { name: 'Title' }), { target: { value: 'Sharper title' } });
    fireEvent.change(within(p).getByRole('textbox', { name: 'Tags' }), { target: { value: 'hooks, tiktok' } });
    fireEvent.change(within(p).getByRole('combobox', { name: 'Stage' }), { target: { value: 'validated' } });
    fireEvent.change(within(p).getByRole('textbox', { name: 'Why this change?' }), { target: { value: 'Clearer' } });
    click('Save', p);
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toEqual([['/api/kb/cards/a?ws=peak', { title: 'Sharper title', tags: ['hooks', 'tiktok'], stage: 'validated', reason: 'Clearer' }]]));
  });

  it('creates a card by hand from the Outline and opens it', async () => {
    const fetch = open('');
    click('New card', await screen.findByRole('navigation', { name: 'Outline' }));
    const p = await screen.findByRole('complementary', { name: 'Card details' });
    fireEvent.change(within(p).getByRole('textbox', { name: 'Title' }), { target: { value: 'Bundles beat discounts' } });
    fireEvent.change(within(p).getByRole('combobox', { name: 'Category' }), { target: { value: 'Advertising › Hooks' } });
    fireEvent.change(within(p).getByRole('textbox', { name: 'Summary' }), { target: { value: 'Kits outsell coupons' } });
    click('Save', p);
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toEqual([['/api/kb/cards', { ws: 'peak', title: 'Bundles beat discounts', category: ['Advertising', 'Hooks'], summary: 'Kits outsell coupons' }]])); // no stage: an owner-set stage would stop the ladder moving it
    await vi.waitFor(() => expect(where()).toBe('/knowledge?ws=peak&card=new1'));
  });
});

describe('Knowledge › promote to General', () => {
  const reply = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('asks an agent to draft a General version and says who is drafting; a refusal says why', async () => {
    open('a', {}, (url) => {
      if (url === '/api/kb/cards/a/promote?ws=peak') return reply({ runId: 'r1', agentId: 'peak:market_analyst' }, 202);
      if (url === '/api/kb/cards/b/promote?ws=peak') return reply({ error: 'Already in General as "Card g"' }, 409);
    });
    let p = await panel();
    click('Promote to General', p);
    expect(await within(p).findByText('Analytics Specialist is drafting a General version. It comes back here for your call.')).toBeTruthy();
    expect(within(p).getByRole('link', { name: 'Watch' }).getAttribute('href')).toBe('/agents/peak%3Amarket_analyst?run=r1');
    expect(within(p).getByRole('button', { name: 'Promote to General' })).toHaveProperty('disabled', true);
    cleanup();

    open('b', {}, (url) => (url === '/api/kb/cards/b/promote?ws=peak' ? reply({ error: 'Already in General as "Card g"' }, 409) : undefined));
    p = await panel();
    click('Promote to General', p);
    expect((await within(p).findByRole('alert')).textContent).toBe('Already in General as "Card g"');
  });

  it('a draft waiting for the owner shows against the card, word by word, to approve, edit or keep in the store', async () => {
    const draft = {
      id: 'p1', storeId: 'peak', agentId: 'peak:market_analyst', title: 'Promote to General: Card a', reason: 'It held in 200 ads.', status: 'pending', createdAt: now,
      action: { kind: 'kb.promote', payload: { cardId: 'a', title: 'Any card a', summary: 'Summary a' } },
    };
    const other = { ...draft, id: 'p0', reason: "Card b's draft", action: { kind: 'kb.promote', payload: { cardId: 'b', title: 'Any card b', summary: 'Summary b' } } };
    const fetch = open('a', {}, (url) => (url.startsWith('/api/approvals?') ? [other, draft] : url.startsWith('/api/kb/promotions/') ? draft : undefined));
    const p = await panel();
    const box = await within(p).findByRole('region', { name: 'General version' });
    expect(within(box).getByText('It held in 200 ads.')).toBeTruthy();
    // Title "Card a" → "Any card a"; the summary stays; the draft drops the body.
    expect([...box.querySelectorAll('del')].map((e) => e.textContent)).toEqual(['Removed: Card', 'Removed: Explanation a']);
    expect([...box.querySelectorAll('ins')].map((e) => e.textContent)).toEqual(['Added: Any card']);
    expect(within(p).getByRole('button', { name: 'Promote to General' })).toHaveProperty('disabled', true);
    click('Approve', box);
    click('Keep in store', box);
    await vi.waitFor(() => expect(sent(fetch, 'POST')).toEqual([['/api/approvals/p1/approve', undefined], ['/api/approvals/p1/deny', undefined]]));

    click('Edit', box);
    const field = (name: string) => within(box).getByRole('textbox', { name }) as HTMLInputElement;
    expect([field('Title').value, field('Summary').value, field('Body').value]).toEqual(['Any card a', 'Summary a', '']);
    fireEvent.change(field('Title'), { target: { value: 'Lead with the problem' } });
    fireEvent.change(field('Body'), { target: { value: ' Shown in the first 3 seconds. ' } });
    click('Save', box);
    await vi.waitFor(() => expect(sent(fetch, 'PATCH')).toEqual([['/api/kb/promotions/p1?ws=peak', { title: 'Lead with the problem', summary: 'Summary a', body: 'Shown in the first 3 seconds.' }]]));
    expect(await within(box).findByRole('button', { name: 'Approve' })).toBeTruthy();
  });

describe('Tests (KB-21)', () => {
  it("opens on the plan form when asked (the Research Center's Plan a test), and Cancel drops the ask from the URL", async () => {
    open('a&plan=1');
    const form = await screen.findByRole('form', { name: 'Plan a test' });
    expect(screen.getByTestId('where').textContent).toContain('plan=1');
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Plan a test' })).toBeNull();
    expect(screen.getByTestId('where').textContent).not.toContain('plan=1');
  });
});
});
