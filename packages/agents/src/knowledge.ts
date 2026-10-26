import { AGENT_ROLES, NICHES, PLATFORMS, type AgentRole, type KnowledgeDoc, type KnowledgeKind } from '@frontline/shared';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { customNichePacks, saveNichePack } from './niche';
import { editedLayerPath, nichePack, platformPack, playbook } from './prompt';

// Knowledge Base: every expertise layer the agents read, as the owner sees and edits it.

const DIRS: Record<KnowledgeKind, string> = { playbook: 'playbooks', platform: 'packs/platform', niche: 'packs/niche' };
const edited = (kind: KnowledgeKind, key: string) => editedLayerPath(`${DIRS[kind]}/${key}.md`);

const doc = (kind: KnowledgeKind, key: string, markdown: string, fallback: string, custom = false): KnowledgeDoc => ({
  kind, key, title: markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback, ...(custom ? { custom } : {}),
  ...(!custom && existsSync(edited(kind, key)) ? { edited: true } : {}), chars: markdown.length, markdown,
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

/** Saves the owner's version of a layer (only known layers, so `key` is never an arbitrary path); every run reads it from then on. */
export function saveKnowledge(kind: string, key: string, markdown: string): KnowledgeDoc | undefined {
  const d = knowledgeDoc(kind, key);
  if (!d) return undefined;
  if (d.custom) saveNichePack(key.slice('other:'.length), markdown);
  else {
    const path = edited(d.kind, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, markdown.trim() + '\n');
  }
  return knowledgeDoc(kind, key);
}

/** Drops the owner's edit, back to the shipped layer. Custom niche packs have no shipped version. */
export function resetKnowledge(kind: string, key: string): KnowledgeDoc | 'custom' | undefined {
  const d = knowledgeDoc(kind, key);
  if (!d || d.custom) return d && 'custom';
  rmSync(edited(d.kind, key), { force: true });
  return knowledgeDoc(kind, key);
}
