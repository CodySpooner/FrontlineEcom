// Same as the agents' nicheSlug (packages/agents/src/niche.ts, which the web app doesn't depend on): a custom niche's
// research finds are filed under `other:<slug>`.
export const nicheSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
