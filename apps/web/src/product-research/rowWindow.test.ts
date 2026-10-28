import { expect, test } from 'vitest';
import { rowWindow } from './rowWindow';

test('rowWindow keeps whole rows around the viewport, with spacer rows above and below', () => {
  // 1,000 cards in 4 columns (250 rows of 400 px), a 900 px viewport.
  expect(rowWindow(1000, 4, 400, 0, 900)).toEqual({ from: 0, to: 24, above: 0, below: 244 }); // rows 0–5: 3 visible + 3 below
  expect(rowWindow(1000, 4, 400, 40_000, 900)).toEqual({ from: 388, to: 424, above: 97, below: 144 }); // rows 97–105
  expect(rowWindow(1000, 4, 400, 99_600, 900)).toEqual({ from: 984, to: 1000, above: 246, below: 0 }); // the last rows (249 at the top)
  expect(rowWindow(1001, 4, 400, 200_000, 900)).toEqual({ from: 1001, to: 1001, above: 251, below: 0 }); // past the end: nothing, never negative
  expect(rowWindow(10, 3, 400, -500, 900)).toEqual({ from: 0, to: 10, above: 0, below: 0 }); // grid still below the fold
});
