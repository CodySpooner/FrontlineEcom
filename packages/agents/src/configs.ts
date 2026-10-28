import type { DatabaseSync } from 'node:sqlite';
import type { AgentConfig, RuntimeId } from '@frontline/shared';

// Configured agents live in `agent_configs` (migration #50): written once, never edited in place (decision 3).

export function getConfig(db: DatabaseSync, id: string): AgentConfig | undefined {
  const r = db.prepare('SELECT * FROM agent_configs WHERE id = ?').get(id);
  if (!r) return undefined;
  const opt = (k: string) => (r[k] == null ? {} : { [k === 'custom_role_id' ? 'customRoleId' : k]: String(r[k]) });
  return {
    id: String(r.id),
    storeId: String(r.store_id),
    agentId: String(r.agent_id),
    ...opt('custom_role_id'),
    runtime: String(r.runtime) as RuntimeId,
    ...opt('model'),
    ...opt('effort'),
    tools: JSON.parse(String(r.tools_json)),
    knowledge: JSON.parse(String(r.knowledge_json)),
    permissions: JSON.parse(String(r.permissions_json)),
    createdAt: String(r.created_at),
  };
}
