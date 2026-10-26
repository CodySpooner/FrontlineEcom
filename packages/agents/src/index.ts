export { runAgent, defaultEngine, type Engine, type RunInput } from './engine';
export { fakeEngine, echoScript, type FakeScript, type FakeStep } from './fake-engine';
export { claudeEngine, toAgentEvents, type ClaudeEngineOptions } from './claude-engine';
export { ROLES, SQUAD_RULES, type RoleSpec, type ToolName } from './roles';
export { createSquad, ensureSquads, listAgents, getAgent, updateAgent, agentId, DEFAULT_AUTONOMY } from './squads';
export { assemblePrompt, playbook, platformPack, nichePack, estimateTokens, type PromptInput } from './prompt';
export {
  writeMemory,
  getMemory,
  listMemory,
  updateMemory,
  deleteMemory,
  adjustConfidence,
  searchMemory,
  parseLearnings,
  promotionCandidates,
  REFLECTION_PROMPT,
  type NewMemory,
} from './memory';
export { APP_TOOLS, toolsFor, callTool, type AppTool, type ToolEnv, type ToolContext } from './tools';
export { nicheSlug, customNichePack, saveNichePack, draftNichePackTask } from './niche';
