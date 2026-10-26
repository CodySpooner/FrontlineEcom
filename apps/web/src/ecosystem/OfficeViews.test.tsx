// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AgentRun, OfficeSeat } from '@frontline/shared';
import { renderApp } from '../test-utils';
import { OfficeViews, taskColumn } from './OfficeViews';
import { emptyOffice } from './events';
import { appearanceFor } from './characters';

vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: () => <span>Portrait</span> }));
afterEach(cleanup);
test('roster searches the same seat identity and opens its worker', () => {
  const office = emptyOffice(), select = vi.fn();
  const seats: OfficeSeat[] = ['Nova', 'Atlas'].map((displayName, i) => ({ agentId: `agent${i}`, deskId: `research-${i + 1}`, displayName, appearance: appearanceFor(displayName), position: null, archived: false, updatedAt: '' }));
  renderApp(<OfficeViews tab="Agent List" office={office} seats={seats} onSelect={select} />);
  fireEvent.change(screen.getByLabelText('Find worker'), { target: { value: 'nova' } });
  expect(screen.queryByText('Atlas')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Nova/ }));
  expect(select).toHaveBeenCalledWith('agent0');
});
test('approval column uses the run relationship and never masks a terminal result', () => {
  const office = emptyOffice(), run = { id: 'r1', status: 'running' } as AgentRun;
  office.approvals.a = { runId: 'r1', status: 'pending' } as typeof office.approvals[string];
  expect(taskColumn(run, office)).toBe('Awaiting approval');
  expect(taskColumn({ ...run, status: 'done' }, office)).toBe('Completed');
  expect(taskColumn({ ...run, id: 'r2', status: 'queued' }, office)).toBe('Queued');
});
