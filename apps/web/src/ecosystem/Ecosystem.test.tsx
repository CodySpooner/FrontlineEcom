// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { renderApp } from '../test-utils';
import { Ecosystem } from './Ecosystem';

afterEach(cleanup);
test('office tabs and collapsible activity are keyboard-addressable', () => {
  renderApp(<Ecosystem />, '/ecosystem');
  expect(screen.getByRole('heading', { name: 'AI ECOSYSTEM' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Agent List' }));
  expect(screen.getByRole('tab', { name: 'Agent List' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }));
  expect(screen.queryByRole('heading', { name: 'Live Activity' })).toBeNull();
});
