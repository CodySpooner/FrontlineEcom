import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { shouldToast } from './toast';

test("a notification marked toast: false never toasts; others toast only while Frontline isn't focused", () => {
  expect(shouldToast({ toast: false }, false)).toBe(false);
  expect(shouldToast({ toast: true }, false)).toBe(true);
  expect(shouldToast({}, false)).toBe(true); // a server from before the flag
  expect(shouldToast({ toast: true }, true)).toBe(false);
  // main.ts decides with it (main.ts itself can't load here).
  expect(readFileSync('apps/desktop/src/main.ts', 'utf8')).toContain('!shouldToast(n, !!(win?.isVisible() && win.isFocused()))');
});
