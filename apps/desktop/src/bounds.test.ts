import { expect, test } from 'vitest';
import { initialBounds } from './bounds';

const laptop = { x: 0, y: 0, width: 1366, height: 728 }; // 1366×768 less the taskbar
const desk = { x: 0, y: 0, width: 1920, height: 1040 };

test('first launch: the default size fitted to the primary screen, centered', () => {
  expect(initialBounds({}, [desk])).toEqual({ x: 240, y: 70, width: 1440, height: 900, maximized: false });
  expect(initialBounds({}, [laptop])).toEqual({ x: 0, y: 0, width: 1366, height: 728, maximized: false });
});

test('later launches reopen where the window was, unless that screen is gone', () => {
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };
  const there = { bounds: { x: 2100, y: 100, width: 1600, height: 1000 }, maximized: true };
  expect(initialBounds(there, [desk, second])).toEqual({ ...there.bounds, maximized: true });
  // The second monitor was unplugged: back on the primary screen, still maximized.
  expect(initialBounds(there, [desk])).toEqual({ x: 240, y: 70, width: 1440, height: 900, maximized: true });
  // Same place on a smaller screen than before: shrunk to fit.
  expect(initialBounds({ bounds: { x: 10, y: 10, width: 1800, height: 1000 } }, [laptop])).toEqual({ x: 10, y: 10, width: 1366, height: 728, maximized: false });
});
