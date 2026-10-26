/** Resolves once the API answers again after a restart: wait out the exit, then ping until it's up. */
export async function waitForApi(ping: () => Promise<boolean>, every = 1000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  // The API exits ~300ms after answering; a ping before that would hit the old process.
  await sleep(every);
  while (!(await ping())) await sleep(every);
}

export const apiUp = () => fetch('/api/health').then(
  (r) => r.ok,
  () => false,
);
