import { describe, expect, it } from 'vitest';
import { matchPages } from './palette';

const pages = [
  { label: 'Dashboard', subtitle: 'Your ecom business.' },
  { label: 'Store Analytics', subtitle: 'Every number. Every store.' },
  { label: 'Settings', subtitle: 'Stores, caps and preferences.' },
];

describe('matchPages', () => {
  it('lists every page for an empty query', () => {
    expect(matchPages('  ', pages)).toEqual(pages);
  });
  it('puts labels that start with the query first', () => {
    expect(matchPages('st', pages).map((p) => p.label)).toEqual(['Store Analytics', 'Settings']);
    expect(matchPages('caps', pages).map((p) => p.label)).toEqual(['Settings']);
    expect(matchPages('nothing like it', pages)).toEqual([]);
  });
});
