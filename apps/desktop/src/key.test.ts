import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadKey } from './key';

// Stand-in for safeStorage: reversible, and the file never holds the key in the clear.
const safe = {
  encryptString: (s: string) => Buffer.from(`enc:${s}`).reverse(),
  decryptString: (b: Buffer) => {
    const s = Buffer.from(b).reverse().toString();
    if (!s.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext');
    return s.slice(4);
  },
};

test('creates the key once, encrypted, and reloads the same key', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'frontline-key-')), 'nested', 'secret.key.enc');
  const never = () => expect.fail('should not ask to reset');
  const key = loadKey(file, safe, never);
  expect(key).toHaveLength(32);
  expect(readFileSync(file).includes(key.toString('base64'))).toBe(false);
  expect(loadKey(file, safe, never).equals(key)).toBe(true);
});

test('an undecryptable key file is only replaced when the owner agrees, and is kept aside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'frontline-key-'));
  const file = join(dir, 'secret.key.enc');
  writeFileSync(file, 'garbage');
  expect(() => loadKey(file, safe, () => false)).toThrow(/decrypting/);
  expect(readFileSync(file, 'utf8')).toBe('garbage');

  const key = loadKey(file, safe, () => true);
  expect(loadKey(file, safe, () => false).equals(key)).toBe(true);
  const aside = readdirSync(dir).find((f) => f.startsWith('secret.key.enc.unreadable-'));
  expect(readFileSync(join(dir, aside!), 'utf8')).toBe('garbage');
});
