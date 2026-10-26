import { describe, expect, it } from 'vitest';
import { toggleStore } from './StoreFilter';

describe('toggleStore', () => {
  it('adds and removes stores from the selection', () => {
    expect(toggleStore([], 'a', 3)).toEqual(['a']);
    expect(toggleStore(['a', 'b'], 'a', 3)).toEqual(['b']);
  });
  it('collapses to All once every store is picked', () => {
    expect(toggleStore(['a', 'b'], 'c', 3)).toEqual([]);
  });
  it('deselecting the last store means All', () => {
    expect(toggleStore(['a'], 'a', 3)).toEqual([]);
  });
});
