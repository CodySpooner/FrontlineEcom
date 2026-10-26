// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp } from '../test-utils';
import { OfficeScene } from './OfficeScene';
import { createOffice } from './renderer';
import { emptyOffice } from './events';
import { DEFAULT_DISPLAY } from './display';
import { appearanceFor } from './characters';

vi.mock('./renderer', () => ({ createOffice: vi.fn() }));
afterEach(cleanup);

test('worker inspection remains accessible when graphics cannot start', async () => {
  vi.mocked(createOffice).mockRejectedValue(new Error('WebGL unavailable'));
  const select = vi.fn();
  renderApp(<OfficeScene office={emptyOffice()} onSelect={select} display={DEFAULT_DISPLAY} theme="frontline" seats={[{ agentId: 'glow:copywriter', deskId: 'copywriting-1', displayName: 'Nova', appearance: appearanceFor('Nova'), archived: false, position: null, updatedAt: '' }]} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Use the workstation directory or Agent List');
  fireEvent.click(screen.getByText('Workstation directory'));
  fireEvent.click(screen.getByRole('button', { name: 'copywriting-1' }));
  expect(select).toHaveBeenCalledWith('glow:copywriter');
});
