import { expect, test } from 'vitest';
import { clampPanes, paneMode } from './layout';
import { agentsUrl } from './urls';

test('the centre keeps 480 px: the right panel gives way first, then the left', () => {
  expect(clampPanes(1100, { left: 400, right: 420 })).toEqual({ mode: 'three', left: 340, right: 280 });
  expect(clampPanes(1208, { left: 292, right: 316 })).toEqual({ mode: 'three', left: 292, right: 316 });
  expect(clampPanes(1100, { left: 400, right: 420 }, false)).toMatchObject({ left: 400 }); // a closed panel takes nothing
  // Two panes: left ≤ workspace − 480, never under 240.
  expect(clampPanes(792, { left: 400, right: 420 })).toMatchObject({ mode: 'two', left: 312 });
  expect(clampPanes(720, { left: 400, right: 420 })).toMatchObject({ mode: 'two', left: 240 });
  // Stored widths outside the drag limits come back inside them.
  expect(clampPanes(1600, { left: 900, right: 10 })).toEqual({ mode: 'three', left: 400, right: 280 });
  expect([paneMode(1099), paneMode(719)]).toEqual(['two', 'one']);
});

test('every workspace URL carries its store', () => {
  expect(agentsUrl({ store: 'glow' })).toBe('/agents?store=glow');
  expect(agentsUrl({ store: 'glow', conversation: 'c1' })).toBe('/agents/c/c1?store=glow');
  expect(agentsUrl({ store: 'my store', team: 't/1' })).toBe('/agents/t/t%2F1?store=my%20store');
});
