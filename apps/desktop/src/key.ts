import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SafeStorage } from 'electron';

/**
 * The 32-byte credentials key, kept in `file` encrypted by safeStorage and created on first run.
 * On Windows safeStorage's own key lives in Chromium's `Local State`, written ~10s after it changes, so a crash right
 * after the first start (or a profile/machine change) can leave `file` undecryptable. Then `confirmReset()` asks the
 * owner: yes moves the old file aside and starts a new key (saved credentials must be re-entered), no throws.
 */
export function loadKey(file: string, safe: Pick<SafeStorage, 'encryptString' | 'decryptString'>, confirmReset: () => boolean): Buffer {
  try {
    return Buffer.from(safe.decryptString(readFileSync(file)), 'base64');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (!confirmReset()) throw e;
      renameSync(file, `${file}.unreadable-${Date.now()}`);
    }
  }
  const key = randomBytes(32);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, safe.encryptString(key.toString('base64')), { flag: 'wx' });
  return key;
}
