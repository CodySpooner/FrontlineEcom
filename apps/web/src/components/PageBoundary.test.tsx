// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { renderApp, stubApi } from '../test-utils';
import { PageBoundary } from './Shell';

function Boom(): never {
  throw new Error('kaboom');
}

// Same wiring as Shell: the boundary is keyed by path.
function Pages() {
  const { pathname } = useLocation();
  return (
    <PageBoundary key={pathname}>
      <Routes>
        <Route path="/boom" element={<Boom />} />
        <Route path="/" element={<p>Command Center</p>} />
      </Routes>
    </PageBoundary>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PageBoundary', () => {
  it('shows a way out instead of a blank window, and clears on navigation', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubApi(() => []);
    renderApp(<Pages />, '/boom');
    expect(screen.getByRole('alert').textContent).toContain('This page hit a snag');
    expect(screen.getByText('kaboom')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Go to Dashboard' }));
    expect(screen.getByText('Command Center')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
