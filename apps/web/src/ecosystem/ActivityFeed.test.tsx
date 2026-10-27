// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { OfficeSeat } from '@frontline/shared';
import { renderApp } from '../test-utils';
import { ActivityFeed } from './ActivityFeed';
import { emptyOffice } from './events';
import { appearanceFor } from './characters';
vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: ({ name, agentId, appearance }: { name: string; agentId: string; appearance: OfficeSeat['appearance'] }) => <span role="img" aria-label={`${name} portrait`} data-agent={agentId} data-color={appearance.color} /> }));

afterEach(cleanup);
test('focuses a deployed sender and opens the actual receiving task', () => {
  const office = emptyOffice(), focus = vi.fn();
  office.events = [{ id: 'handoff', type: 'handoff', agentId: 'glow:copywriter', toAgentId: 'glow:creative_studio', runId: 'child', at: new Date().toISOString(), summary: 'Create images from approved copy' }];
  const seat: OfficeSeat = { agentId: 'glow:copywriter', deskId: 'copywriting-1', displayName: 'Nova', appearance: appearanceFor('nova'), position: null, archived: false, updatedAt: '' };
  renderApp(<ActivityFeed office={office} seats={[seat]} onFocus={focus} />);
  expect(screen.getByRole('img', { name: 'Nova portrait' }).getAttribute('data-agent')).toBe(seat.agentId);
  expect(screen.getByRole('img', { name: 'Nova portrait' }).getAttribute('data-color')).toBe(seat.appearance.color);
  fireEvent.click(screen.getByRole('button', { name: 'Nova' }));
  expect(focus).toHaveBeenCalledWith('glow:copywriter');
  expect(screen.getByRole('link', { name: 'Open task →' }).getAttribute('href')).toBe('/agents/glow%3Acreative_studio?run=child');
});
