// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from '../test-utils';
import { NoCustomers } from './CustomersTab';

afterEach(cleanup);

describe('Customers no-data state (SA-103)', () => {
  it('says why there is no customer to follow and links the fix', () => {
    renderApp(<NoCustomers why={{ reason: 'needs_permission', note: "Shopify hasn't allowed reading the orders' customer (protected customer data)", fix: { label: 'Allow customer data for Shopify', href: '/settings/integrations?store=a' } }} />);
    const box = screen.getByRole('region', { name: 'No customer data' });
    expect(box.textContent).toBe("No customer data for this periodNeeds permissionShopify hasn't allowed reading the orders' customer (protected customer data)Allow customer data for Shopify");
    expect(screen.getByRole('link', { name: 'Allow customer data for Shopify' }).getAttribute('href')).toBe('/settings/integrations?store=a');
  });

  it('guest checkouts only: the reason with no link', () => {
    renderApp(<NoCustomers why={{ reason: 'not_tracked', note: 'Every order in this period was a guest checkout, so there is no customer to follow.' }} />);
    expect(screen.getByText('Not tracked')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
