import { expect, test } from 'vitest';
import { DEFAULT_DISPLAY, parseDisplay } from './display';

test('device preferences accept only known booleans and preserve new defaults', () => {
  expect(parseDisplay(null)).toEqual(DEFAULT_DISPLAY);
  expect(parseDisplay({ names: false, bubbles: 'false', unknown: false })).toEqual({ ...DEFAULT_DISPLAY, names: false });
  expect(DEFAULT_DISPLAY.names).toBe(true);
});
