// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { SETTINGS, type ConfigChange } from '@frontline/shared';
import { Settings } from '../../pages/Settings';
import { renderApp, reply, stubApi } from '../../test-utils';

afterEach(() => (cleanup(), vi.unstubAllGlobals()));

const label = (id: string) => SETTINGS.find((d) => d.id === id)!.label;
const at = (i: number) => new Date(Date.UTC(2026, 9, 31, 12) - i * 60_000).toISOString();
/** Pages `rows` by 50 behind an opaque cursor, as the server does; answers the store list and retries. */
function server(rows: ConfigChange[]) {
  return stubApi((url) => {
    if (url === '/api/config/changes/stores') return [{ id: 'glow', name: 'Glow Haus', deleted: false }, { id: 'gone', name: 'Old Shop', deleted: true }];
    if (url.endsWith('/retry?store=glow')) return reply({ ...rows.find((r) => r.state === 'failed'), state: 'applying' }, 202);
    if (url.startsWith('/api/config/changes')) {
      const from = Number(new URL(url, 'http://x').searchParams.get('cursor') ?? 0);
      return { changes: rows.slice(from, from + 50), ...(from + 50 < rows.length ? { next: String(from + 50) } : {}) };
    }
  });
}
const items = async () => within(await screen.findByRole('list', { name: 'Changes' })).getAllByRole('listitem');

test('200 changes page in by 50 with Show older, each once, newest first', async () => {
  const rows = Array.from({ length: 200 }, (_, i): ConfigChange => ({ id: `c${i}`, at: at(i), actor: 'owner', scope: 'workspace', setting: 'runs.atOnce', before: 200 - i, after: 201 - i, state: 'saved' }));
  server(rows);
  renderApp(<Settings />, '/settings/history');
  expect(await items()).toHaveLength(50);
  for (const n of [100, 150, 200]) {
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(async () => expect(await items()).toHaveLength(n));
  }
  expect((await items()).map((li) => li.querySelector('p')!.textContent)).toEqual(rows.map((r) => `${r.before} → ${r.after}`));
  expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
});

test("each row says what changed, where, by whom, and before → after by type; a secret only says it was replaced; an unknown id shows as it is", async () => {
  server([
    { id: 'a', at: at(0), actor: 'owner', scope: 'workspace', setting: 'baseCurrency', before: 'USD', after: 'EUR', state: 'saved' },
    { id: 'b', at: at(1), actor: 'sync:shopify', scope: 'store', storeId: 'glow', storeName: 'Glow Haus', setting: 'store.feePercent', before: 0, after: 2.9, state: 'saved' },
    { id: 'c', at: at(2), actor: 'import', scope: 'personal', setting: 'notifications.toasts.errors', before: true, after: false, state: 'saved' },
    { id: 'd', at: at(3), actor: 'migration', scope: 'store', storeId: 'gone', storeName: 'Old Shop', setting: 'kb.trustedDomains', before: null, after: ['a.com', 'b.com'], state: 'saved' },
    { id: 'e', at: at(4), actor: 'owner', scope: 'workspace', setting: 'cj.apiKey', state: 'saved', detail: 'replaced' },
    { id: 'f', at: at(5), actor: 'system', scope: 'workspace', setting: 'legacy.limits', before: { daily: 1 }, after: { daily: 2 }, state: 'saved' },
  ]);
  renderApp(<Settings />, '/settings/history');
  const said = (await items()).map((li) => [li.querySelector('.font-medium')!.textContent, li.querySelector('.text-xs')!.textContent!.split(' · ').slice(0, 2).join(' · '), li.querySelector('p')!.textContent]);
  expect(said).toEqual([
    [label('baseCurrency'), 'Workspace · You', 'USD → EUR'],
    [label('store.feePercent'), 'Glow Haus · Shopify sync', '0 → 2.9'],
    [label('notifications.toasts.errors'), 'Personal · Import', 'On → Off'],
    ['Trusted sites', 'Old Shop · Migration', 'Not set → a.com, b.com'],
    ['cj.apiKey', 'Workspace · You', 'Replaced'],
    ['legacy.limits', 'Workspace · System', 'daily: 1 → daily: 2'],
  ]);
});

test('filters by scope, by a store that was deleted, and by a search over setting names', async () => {
  const fetch = server([{ id: 'd', at: at(0), actor: 'owner', scope: 'store', storeId: 'gone', storeName: 'Old Shop', setting: 'store.feePercent', before: 1, after: 2, state: 'saved' }]);
  renderApp(<Settings />, '/settings/history');
  await items();
  const store = screen.getByRole('combobox', { name: 'Store' });
  await waitFor(() => expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual(['Every store', 'Glow Haus', 'Old Shop (deleted)']));
  fireEvent.change(screen.getByRole('combobox', { name: 'Scope' }), { target: { value: 'store' } });
  fireEvent.change(store, { target: { value: 'gone' } });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: ' fees ' } });
  await waitFor(() => expect(fetch.mock.calls.map(([u]) => String(u))).toContain('/api/config/changes?scope=store&store=gone&search=fees'));
  expect((await items())[0]!.textContent).toContain('Old Shop');
});

test('only a failed apply has Retry, and it runs that change again', async () => {
  const fetch = server(
    (['saved', 'applying', 'applied', 'failed'] as const).map((state, i) => ({ id: `s${i}`, at: at(i), actor: 'owner', scope: 'store', storeId: 'glow', storeName: 'Glow Haus', setting: 'store.feePercent', before: i, after: i + 1, state, ...(state === 'failed' ? { detail: 'Shopify was unreachable' } : {}) })),
  );
  renderApp(<Settings />, '/settings/history');
  const rows = await items();
  expect(rows.map((li) => [li.querySelector('.ml-auto')!.textContent])).toEqual([['Saved'], ['Applying…'], ['Applied'], ['FailedRetry']]);
  expect(rows[3]!.textContent).toContain('Shopify was unreachable');
  fireEvent.click(within(rows[3]!).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(fetch.mock.calls.filter(([u, i]) => u === '/api/config/changes/s3/retry?store=glow' && i?.method === 'POST')).toHaveLength(1));
});
