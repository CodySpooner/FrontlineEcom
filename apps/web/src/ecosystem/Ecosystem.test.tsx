// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp } from '../test-utils';
import { Ecosystem } from './Ecosystem';

vi.mock('./OfficeScene', () => ({ OfficeScene: () => <div>Office canvas</div> }));
vi.mock('./useOffice', () => ({ useOffice: () => ({ state: { agents: [], runs: {}, approvals: {}, tools: {}, events: [], missions: {} }, connected: true, error: '' }) }));
vi.mock('./api', () => ({ useSeats: () => ({ data: [] }), useOfficeStats: () => ({ data: { activeTasks: 0, activeTeams: 0, successRate: null } }) }));

afterEach(() => { cleanup(); localStorage.clear(); });
test('office tabs and collapsible activity are keyboard-addressable', () => {
  renderApp(<Ecosystem />, '/ecosystem');
  expect(screen.getByRole('heading', { name: 'AI ECOSYSTEM' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Agent List' }));
  expect(screen.getByRole('tab', { name: 'Agent List' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(screen.queryByRole('heading', { name: 'Live Activity' })).toBeNull();
});
test('office display preferences are accessible and saved on this device', () => {
  renderApp(<Ecosystem />, '/ecosystem');
  fireEvent.click(screen.getByRole('button', { name: 'Office Settings' }));
  const names = screen.getByRole('switch', { name: 'Agent names' }) as HTMLInputElement;
  expect(names.checked).toBe(true);
  fireEvent.click(names);
  expect(JSON.parse(localStorage.getItem('frontline.ecosystem.display')!).names).toBe(false);
});
