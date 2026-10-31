// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp, stubApi } from '../test-utils';
import { Ecosystem } from './Ecosystem';
import { useOffice } from './useOffice';
import { useSeats } from './api';

vi.mock('./OfficeScene', () => ({ OfficeScene: ({ persist }: { persist: boolean }) => <p>Position saving: {String(persist)}</p> }));
vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Portrait</span> }));
vi.mock('./useOffice', () => ({ useOffice: vi.fn(() => ({ state: { agents: [], runs: {}, approvals: {}, tools: {}, events: [], missions: {} }, connected: true, error: '' })) }));
vi.mock('./api', () => ({ useSeats: vi.fn(() => ({ data: [] })), useOfficeStats: () => ({ data: { activeTasks: 0, activeTeams: 0, successRate: null } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
test('switching to demo stops office subscriptions and saves; simulated commands never POST', async () => {
  vi.useFakeTimers();
  const fetch = stubApi(() => []);
  renderApp(<Ecosystem />);
  fireEvent.click(screen.getByRole('switch', { name: 'Demo Mode' }));
  expect(useOffice).toHaveBeenLastCalledWith(false, []);
  expect(useSeats).toHaveBeenLastCalledWith(false);
  expect(screen.getByText('Position saving: false')).toBeTruthy();
  expect(screen.getByText('30 / 30')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Quick Assign' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ad Strategist 1 · demo-0' }));
  fireEvent.change(screen.getByLabelText('Demo task'), { target: { value: 'Test local preview' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simulate task' }));
  await act(async () => { vi.advanceTimersByTime(6000); });
  expect(within(screen.getByRole('dialog')).getByText('Demo: Test local preview')).toBeTruthy();
  expect(fetch.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Demo Mode' }));
  expect(useOffice).toHaveBeenLastCalledWith(true, []);
  expect(screen.getByText('Position saving: true')).toBeTruthy();
});
