import { createFetcher } from './fetcher';

// One fetcher for the app: its per-site gap and robots.txt cache only hold if every task shares it (knowledge base
// research, agent fetches, product research previews and images).
export const kbFetch = createFetcher();
