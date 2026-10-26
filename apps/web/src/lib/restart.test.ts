import { describe, expect, it } from 'vitest';
import { waitForApi } from './restart';

describe('waitForApi', () => {
  it('waits out the exit, then pings until the API answers', async () => {
    const answers = [false, false, true];
    const log: string[] = [];
    await waitForApi(
      async () => (log.push('ping'), answers.shift()!),
      10,
      async () => void log.push('sleep'),
    );
    expect(log).toEqual(['sleep', 'ping', 'sleep', 'ping', 'sleep', 'ping']);
  });
});
