// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { KbCampaign, KbCard, KbExperiment } from '@frontline/shared';
import { renderApp, stubApi } from '../test-utils';
import { Tests } from './Tests';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const store = (id: string, name: string, connected: boolean) => ({ id, name, connected, platform: 'shopify', niche: 'pets', color: '#f00', currency: 'USD', timezone: 'UTC' });
const STORES = [store('peak', 'Peak Outdoors', true), store('paw', 'Pawsome', false)];
const card = { id: 'c1', storeId: 'peak', status: 'active', title: 'Dog-car ads beat broad ones' } as KbCard;
const camp = (id: string, name: string, creatives: KbCampaign['creatives'] = []): KbCampaign => ({
  network: 'meta', id, storeId: 'peak', name, status: 'active', spend: 0, revenue: 0, purchases: 0, clicks: 0, impressions: 0, ads: 0, groups: 0, creatives, experiments: [], cards: [],
});
const CAMPAIGNS = [camp('dog', 'Dog car', [{ id: 'k1', headline: 'Car calm', primaryText: 'x', hook: 'problem-first' }]), camp('broad', 'Broad')];
const PLANNED: KbExperiment = {
  id: 'e1', cardId: 'c1', storeId: 'peak', metric: 'roas', minSample: 30, status: 'planned', from: '2026-11-01', to: '2026-11-28', due: '2026-12-28', createdAt: '2026-10-27T10:00:00Z',
  variants: [{ label: 'Broad', campaigns: ['meta:broad'], creatives: [] }, { label: 'Dog car', campaigns: ['meta:dog'], creatives: [] }],
};
const WORKED: KbExperiment = { ...PLANNED, id: 'e2', status: 'worked', result: 'Test of "Dog car" against "Broad": ROAS 3.00 vs 1.50. "Dog car" did better: it worked.' };

const api = (tests: KbExperiment[] = [PLANNED, WORKED], post: (body: unknown, url: string) => unknown = () => PLANNED) =>
  stubApi((url, init) =>
    url === '/api/stores'
      ? STORES
      : url.startsWith('/api/kb/cards/c1/experiments')
        ? init?.method === 'POST'
          ? post(JSON.parse(String(init.body)), url)
          : tests
        : url.startsWith('/api/kb/campaigns')
          ? CAMPAIGNS
          : url.startsWith('/api/kb/experiments/')
            ? new Response(null, { status: 204 })
            : undefined,
  );

describe('Tests', () => {
  it("lists the card's tests: a planned one with its due date and Cancel, a read one with its result", async () => {
    const fetch = api();
    renderApp(<Tests card={card} />);
    const [planned, worked] = within(await screen.findByRole('list', { name: 'Tests' })).getAllByRole('listitem');
    expect(planned!.textContent).toContain('"Dog car" vs "Broad" · ROAS · 2026-11-01 – 2026-11-28');
    expect(planned!.textContent).toContain('Planned: the result is due 2026-12-28, once its attribution settles.');
    expect(worked!.textContent).toContain('Worked');
    expect(worked!.textContent).toContain(WORKED.result);
    expect(within(worked!).queryByRole('button', { name: 'Cancel test' })).toBeNull();
    fireEvent.click(within(planned!).getByRole('button', { name: 'Cancel test' }));
    await waitFor(() => expect(fetch.mock.calls.some(([u, i]) => u === '/api/kb/experiments/e1?ws=peak' && i?.method === 'DELETE')).toBe(true));
  });

  it('plans a test: a metric, two sides of campaigns and creatives, a window and a minimum sample', async () => {
    let sent: unknown;
    api([], (b) => ((sent = b), PLANNED));
    renderApp(<Tests card={card} />);
    expect(await screen.findByText('No tests yet. Plan one to put the card to the test on real numbers.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan a test' }));
    const form = screen.getByRole('form', { name: 'Plan a test' });
    fireEvent.change(await within(form).findByLabelText('Metric'), { target: { value: 'ctr' } });
    const a = within(form).getByRole('group', { name: 'A: the control' });
    const b = within(form).getByRole('group', { name: 'B: what the card says works' });
    fireEvent.change(within(a).getByLabelText('Label'), { target: { value: 'Broad' } });
    fireEvent.click(await within(a).findByLabelText('Broad (Meta)'));
    fireEvent.click(within(b).getByLabelText('Dog car (Meta)'));
    fireEvent.click(within(b).getByLabelText('Car calm · hook: problem-first'));
    fireEvent.change(within(form).getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(within(form).getByLabelText('To'), { target: { value: '2026-11-28' } });
    fireEvent.change(within(form).getByLabelText('Minimum clicks on each side'), { target: { value: '200' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Plan test' }));
    await waitFor(() =>
      expect(sent).toEqual({ metric: 'ctr', variants: [{ label: 'Broad', campaigns: ['meta:broad'], creatives: [] }, { label: 'Variant', campaigns: ['meta:dog'], creatives: ['k1'] }], from: '2026-11-01', to: '2026-11-28', minSample: 200 }),
    );
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Plan a test' })).toBeNull());
  });

  it('opens on the form when asked, and shows why a plan was refused', async () => {
    api([], () => Response.json({ error: 'A campaign or creative can only be on one side' }, { status: 400 }));
    renderApp(<Tests card={card} plan />);
    const form = screen.getByRole('form', { name: 'Plan a test' });
    fireEvent.click(await within(form).findAllByLabelText('Dog car (Meta)').then((x) => x[0]!));
    fireEvent.click(within(form).getAllByLabelText('Dog car (Meta)')[1]!);
    fireEvent.click(within(form).getByRole('button', { name: 'Plan test' }));
    expect((await screen.findByRole('alert')).textContent).toContain('A campaign or creative can only be on one side');
  });

  it('a General card is tested on a store it picks; a demo store says why it cannot be', async () => {
    let to = '';
    let sent: unknown;
    api([], (b, url) => ((sent = b), (to = url), PLANNED));
    renderApp(<Tests card={{ ...card, storeId: null }} plan />);
    const form = screen.getByRole('form', { name: 'Plan a test' });
    await within(form).findByRole('option', { name: 'Pawsome' });
    fireEvent.change(within(form).getByLabelText('Store'), { target: { value: 'paw' } });
    expect(within(form).getByText("Tests read a store's real ad numbers: Pawsome is a demo store. Connect its ad account first.")).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Plan test' })).toBeNull();
    fireEvent.change(within(form).getByLabelText('Store'), { target: { value: 'peak' } });
    fireEvent.click(await within(form).findAllByLabelText('Broad (Meta)').then((x) => x[0]!));
    fireEvent.click(within(form).getAllByLabelText('Dog car (Meta)')[1]!);
    fireEvent.click(within(form).getByRole('button', { name: 'Plan test' }));
    await waitFor(() => expect(sent).toMatchObject({ storeId: 'peak', metric: 'roas', minSample: 30 }));
    expect(to).toBe('/api/kb/cards/c1/experiments?ws=general');
  });

  it("a card that isn't active or unreviewed can't be tested", async () => {
    api([]);
    renderApp(<Tests card={{ ...card, status: 'archived' }} />);
    expect((await screen.findByRole('button', { name: 'Plan a test' })).hasAttribute('disabled')).toBe(true);
  });
});
