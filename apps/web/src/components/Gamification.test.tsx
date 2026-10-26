// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { renderApp, stubApi } from '../test-utils';
import { XpToasts } from './Gamification';

const xp = (reason: string, amount = 50) =>
  window.dispatchEvent(new CustomEvent('frontline:xp', { detail: { type: 'xp', xp: { id: reason, storeId: 'peak', amount, reason, createdAt: '2026-10-26T08:00:00Z' } } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('XP toasts', () => {
  it('gives a finished mission its own toast, other XP stays a one-liner', async () => {
    stubApi((url) => (url.startsWith('/api/stores') ? [{ id: 'peak', name: 'Peak Fit', currency: 'USD' }] : undefined));
    renderApp(<XpToasts />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      xp('Mission complete: Clear all agent requests');
      xp('Run finished', 10);
    });
    expect(screen.getByText('Mission complete')).toBeTruthy();
    expect(screen.getByText('Clear all agent requests')).toBeTruthy();
    expect(screen.getByText('+10 XP')).toBeTruthy();
    expect(screen.getAllByText(/Mission complete/)).toHaveLength(1);
  });
});
