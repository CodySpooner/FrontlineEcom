import { AGENT_ROLES, NICHES, PLATFORMS, type AgentRole, type KnowledgeDoc, type KnowledgeKind } from '@frontline/shared';
import { customNichePacks } from './niche';
import { nichePack, platformPack, playbook } from './prompt';

// Knowledge Base: every expertise layer the agents read, as the owner sees it.

const doc = (kind: KnowledgeKind, key: string, markdown: string, fallback: string, custom = false): KnowledgeDoc => ({
  kind, key, title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback, ...(custom ? { custom } : {}), chars: markdown.length, markdown,
});

function all(): KnowledgeDoc[] {
  return [
    ...(Object.keys(AGENT_ROLES) as AgentRole[]).map((r) => doc('playbook', r, playbook(r), `${AGENT_ROLES[r].name} playbook`)),
    ...PLATFORMS.map((p) => doc('platform', p, platformPack(p), p)),
    ...NICHES.map((n) => doc('niche', n, nichePack(n), n)),
    ...customNichePacks().map((c) => doc('niche', `other:${c.slug}`, c.markdown, c.slug, true)),
  ].filter((d) => d.markdown);
}

/** The layers without their markdown. */
export const knowledgeIndex = (): KnowledgeDoc[] => all().map(({ markdown: _, ...d }) => d);

export const knowledgeDoc = (kind: string, key: string): KnowledgeDoc | undefined => all().find((d) => d.kind === kind && d.key === key);
