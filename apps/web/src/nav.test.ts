import { expect, it } from 'vitest';
import { pageTitle } from './nav';

it('names the window after the page, agent pages included', () => {
  expect(pageTitle('/')).toBe('Dashboard · Frontline Ecom');
  expect(pageTitle('/orders')).toBe('Orders & Fulfillment · Frontline Ecom');
  expect(pageTitle('/agents/pawsome%3Aad_strategist', () => 'Pawsome Gear')).toBe('Ad Strategist · Pawsome Gear · Frontline Ecom');
  expect(pageTitle('/agents/pawsome:constructor')).toBe('AI Agents · Frontline Ecom');
  // The workspace and its conversations and teams.
  expect(pageTitle('/agents')).toBe('AI Agents · Frontline Ecom');
  expect(pageTitle('/agents/c/c1')).toBe('AI Agents · Frontline Ecom');
  expect(pageTitle('/agents/t/t1')).toBe('AI Agents · Frontline Ecom');
  expect(pageTitle('/ordersx')).toBe('Frontline Ecom');
});
