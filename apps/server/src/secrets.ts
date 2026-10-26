import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ponytail: AES-256-GCM with a key file in the data dir; the desktop app switches to Electron safeStorage (CORE-18).

/**
 * The desktop app passes its key (kept in Electron safeStorage) as base64 in FRONTLINE_SECRET_KEY. Otherwise reads
 * `<dir>/secret.key`, creating a random 32-byte key on first use.
 */
export function loadKey(dir: string): Buffer {
  const fromEnv = process.env.FRONTLINE_SECRET_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('FRONTLINE_SECRET_KEY must be 32 bytes, base64');
    return key;
  }
  const file = join(dir, 'secret.key');
  try {
    return readFileSync(file);
  } catch {
    mkdirSync(dir, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(file, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
}

/** `v1:` + base64(iv | tag | ciphertext). `aad` binds the blob to its row so blobs can't be swapped between rows. */
export function encrypt(key: Buffer, value: unknown, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decrypt<T = unknown>(key: Buffer, blob: string, aad: string): T {
  const raw = Buffer.from(blob.replace(/^v1:/, ''), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)).setAAD(Buffer.from(aad));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
}
