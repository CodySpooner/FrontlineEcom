// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp } from '../test-utils';
import { OfficeScene } from './OfficeScene';
import { createOffice } from './renderer';
import { emptyOffice } from './events';
import { DEFAULT_DISPLAY } from './display';
import { appearanceFor } from './characters';

vi.mock('./renderer', () => ({ createOffice: vi.fn() }));
vi.mock('./WorkerPortrait', () => ({ WorkerPortrait: ({ name }: { name: string }) => <span>{name} portrait</span> }));
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

test('keyboard directory focus previews the actual occupant and clears on blur', async () => {
  let inspectionId: string | undefined;
  const renderer = { setTheme: vi.fn(), setDisplay: vi.fn(), setWorkers: vi.fn(), setBusiness: vi.fn(), destroy: vi.fn(),
    previewWorker: vi.fn((id?: string) => { inspectionId = id; }),
    performance: () => ({ inspectionId, fps: 60, frames: 10, elapsedMs: 200, mode: 'Standard', scale: 1 }),
  };
  vi.mocked(createOffice).mockResolvedValue(renderer as unknown as Awaited<ReturnType<typeof createOffice>>);
  renderApp(<OfficeScene office={emptyOffice()} onSelect={vi.fn()} display={DEFAULT_DISPLAY} theme="frontline" persist={false} seats={[{ agentId: 'glow:copywriter', deskId: 'copywriting-1', displayName: 'Nova', appearance: appearanceFor('Nova'), archived: false, position: null, updatedAt: '' }]} />);
  await waitFor(() => expect(renderer.setWorkers).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Workstation directory'));
  const desk = screen.getByRole('button', { name: 'copywriting-1' });
  fireEvent.focus(desk);
  expect(renderer.previewWorker).toHaveBeenCalledWith('glow:copywriter');
  expect((await screen.findByRole('tooltip')).textContent).toContain('Nova');
  expect(screen.getByRole('tooltip').textContent).toContain('Copywriting');
  expect(desk.getAttribute('aria-describedby')).toBe('eco-worker-preview');
  fireEvent.blur(desk);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  fireEvent.focus(screen.getByRole('button', { name: 'executive-1' }));
  expect(renderer.previewWorker).toHaveBeenLastCalledWith(undefined);
});
