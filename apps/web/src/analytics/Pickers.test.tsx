// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Analytics } from '../pages/Analytics';
import { renderApp, reply } from '../test-utils';

const NOW = Date.parse('2026-10-28T15:00:00Z'); // Oct 28, 11:00 in New York
const where = () => screen.getByTestId('where').textContent!;
// The menus are closed popovers: jsdom gives a hidden element no accessible name, so they're found by id.

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/stores') return reply([{ id: 'a', name: 'Glow Haus' }]);
    if (url.startsWith('/api/analytics/context')) return reply({ storeId: 'a', name: 'Glow Haus', niche: 'beauty', platform: 'shopify', currency: 'USD', demo: false, channels: [], zone: 'America/New_York', zoneLabel: '', zoneAbbr: 'ET', historyStart: '2024-01-01', freshness: [] });
    return new Promise<Response>(() => {});
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Period and compare pickers (SA-65)', () => {
  it("each preset says its dates (today so far where it includes today); picking one moves the URL and the bar", async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    await screen.findByRole('button', { name: /^Last 30 days/ });
    const menu = within(document.getElementById('sa-period')!);
    expect(menu.getByRole('menuitem', { name: /^Today Oct 28 · today so far$/, hidden: true })).toBeTruthy();
    expect(menu.getByRole('menuitem', { name: /^Year to date Jan 1 – Oct 28 · today so far$/, hidden: true })).toBeTruthy();
    expect(menu.getByRole('menuitem', { name: /^Last 365 days Oct 28, 2025 – Oct 27, 2026$/, hidden: true })).toBeTruthy();
    fireEvent.click(menu.getByRole('menuitem', { name: /^Last 7 days Oct 21 – Oct 27$/, hidden: true }));
    await waitFor(() => expect(where()).toContain('period=last7'));
    expect(screen.getByRole('button', { name: 'Last 7 days Oct 21 – Oct 27 · full days' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'vs previous period Oct 14 – Oct 20' })).toBeTruthy();
  });

  it("an invalid custom range can't be applied and says why; a valid one is applied", async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    const form = within(await screen.findByRole('form', { name: 'Custom range', hidden: true }));
    const [from, to, apply] = [form.getByLabelText('From'), form.getByLabelText('To'), form.getByRole('button', { name: 'Apply', hidden: true })];
    fireEvent.change(from, { target: { value: '2026-10-10' } });
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect(form.getByRole('status', { hidden: true }).textContent).toBe('The start is after the end.');
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.submit(apply.closest('form')!); // Enter in a field submits the form: still refused
    expect(where()).not.toContain('period=custom');
    fireEvent.change(from, { target: { value: '2024-01-01' } });
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect(form.getByRole('status', { hidden: true }).textContent).toBe('A range can be at most 730 days.');
    fireEvent.change(to, { target: { value: '2026-10-29' } });
    expect(form.getByRole('status', { hidden: true }).textContent).toBe('The range ends after today.');
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    fireEvent.change(to, { target: { value: '2026-10-10' } });
    expect(apply).toHaveProperty('disabled', false);
    fireEvent.submit(apply.closest('form')!);
    await waitFor(() => expect(where()).toContain('period=custom&from=2026-10-01&to=2026-10-10'));
    expect(screen.getByRole('button', { name: 'Custom range Oct 1 – Oct 10 · full days' })).toBeTruthy();
  });

  it('keyboard only: ↑/↓ move through the choices, and the comparison changes from its menu', async () => {
    renderApp(<Analytics />, '/analytics?store=a');
    await screen.findByRole('button', { name: /^Last 30 days/ });
    const menu = document.getElementById('sa-period')!;
    menu.removeAttribute('popover'); // shown, as its button would: jsdom has no showPopover and focuses nothing in a closed one
    const items = within(menu).getAllByRole('menuitem');
    items[0]!.focus();
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    const compare = within(document.getElementById('sa-compare')!);
    expect(compare.getByRole('menuitem', { name: 'vs same period last year Sep 28 – Oct 27, 2025', hidden: true })).toBeTruthy();
    fireEvent.click(compare.getByRole('menuitem', { name: /^No comparison$/, hidden: true })); // a menu item is a button: Enter and Space press it
    await waitFor(() => expect(where()).toContain('compare=none'));
    expect(screen.getByRole('button', { name: /^No comparison\s*$/ })).toBeTruthy();
  });
});
