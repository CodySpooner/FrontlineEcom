// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { Store } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { CustomRoleForm } from './CustomRoleForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'UTC', color: '#fff', connected: true } as Store;
const contract = (tools: string[]) => ({ responsibility: '', kpi: '', workflow: [], tools, knowledge: [], outputs: [], checks: [] });
const TYPES = [
  { id: 'copywriter', name: 'Copywriter', description: '', baseRole: 'copywriter', contract: contract(['store_summary', 'list_products', 'draft_page']) },
  { id: 'market_analyst', name: 'Analytics Specialist', description: '', baseRole: 'market_analyst', contract: contract(['store_summary', 'compare_stores', 'meta_ads']) },
];

test("the form narrows the base type's tools, shows a refusal on its field, and hands back the role it made", async () => {
  const bodies: unknown[] = [];
  stubApi((url, init) => {
    if (url.startsWith('/api/agent-types')) return TYPES;
    if (url === '/api/custom-roles?store=glow' && init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? reply({ error: 'Name it, in 60 characters or fewer.', field: 'name' }, 400) : reply({ id: 'r1', name: 'Brand Voice', baseRole: 'copywriter' }, 201);
    }
    return undefined;
  });
  const onCreated = vi.fn();
  renderApp(<CustomRoleForm store={store} open onClose={() => {}} onCreated={onCreated} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Brand Voice' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions' }), { target: { value: 'No exclamation marks.' } });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'draft page' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
  expect(await screen.findByText('Name it, in 60 characters or fewer.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' })));
  expect(bodies[1]).toEqual({ name: 'Brand Voice', description: '', instructions: 'No exclamation marks.', baseRole: 'copywriter', tools: ['store_summary', 'list_products'], allStores: false });

  // compare_stores is the Analytics Specialist type's alone; its MCP server is listed by name.
  fireEvent.change(screen.getByRole('combobox', { name: 'Builds on' }), { target: { value: 'market_analyst' } });
  expect(screen.queryByRole('checkbox', { name: 'compare stores' })).toBeNull();
  expect(screen.getByRole('checkbox', { name: 'Meta Ads' })).toBeTruthy();
});
