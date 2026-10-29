// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SA_REASONS, type SaReason } from '@frontline/shared';
import { Unavailable } from './Unavailable';
import { FilterScope } from './FilterScope';

afterEach(cleanup);

describe('Unavailable', () => {
  it.each(Object.keys(SA_REASONS) as SaReason[])('renders the %s reason and never a zero', (reason) => {
    const { container } = render(
      <MemoryRouter>
        <Unavailable value={{ reason, note: 'Shopify site sessions only', fix: { label: 'Connect', href: '/integrations' } }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(SA_REASONS[reason])).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect' }).getAttribute('href')).toBe('/integrations');
    expect(container.textContent).not.toMatch(/\$0|(^|\D)0(\D|$)/);
  });

  it('says Unavailable when no reason is given', () => {
    render(<MemoryRouter><Unavailable value={{}} /></MemoryRouter>);
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });
});

describe('FilterScope', () => {
  it('renders nothing when no filter is ignored', () => {
    const { container } = render(<FilterScope scope={{ applied: ['channel'], ignored: [] }} />);
    expect(container.innerHTML).toBe('');
  });

  it('names each ignored filter with its reason', () => {
    render(<FilterScope scope={{ applied: [], ignored: [{ key: 'collection', reason: 'sessions are store-level' }, { key: 'market', reason: 'ad spend has no country' }] }} />);
    expect(screen.getByText('Collection')).toBeTruthy();
    expect(screen.getByText(/sessions are store-level/)).toBeTruthy();
    expect(screen.getByText(/ad spend has no country/)).toBeTruthy();
  });
});
