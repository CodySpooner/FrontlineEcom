import type { RuntimeModel } from './index';

/** USD per million tokens. Cache writes cost 2x input (Claude Code caches for an hour). */
export interface ModelPrices {
  input: number;
  output: number;
  cacheRead: number;
}

export interface RegistryModel {
  label: string;
  /** Empty: the model takes no effort parameter. */
  efforts: string[];
  /** What the app picks when none is chosen: Claude Code's default for the model (the SDK drives Claude Code). */
  defaultEffort?: string;
  prices: ModelPrices & { over?: ModelPrices & { promptTokens: number } };
}

/**
 * The app's model list (decision 9): only for when discovery fails or leaves a model's effort fields out, and the UI says
 * so. `version` is the day its contents were checked against `sources`. Prices also feed the live cost estimate.
 */
export const RUNTIME_REGISTRY = {
  version: '2026-10-28',
  sources: [
    'https://platform.claude.com/docs/en/about-claude/pricing',
    'https://platform.claude.com/docs/en/build-with-claude/effort',
    'https://platform.claude.com/docs/en/about-claude/models/overview',
    'https://code.claude.com/docs/en/model-config',
  ],
  claude: {
    default: 'claude-opus-5-5',
    // Current models first: an unknown id is priced as the first one of its family (estimate).
    models: {
      'claude-opus-5-5': { label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', prices: { input: 4, output: 20, cacheRead: 0.2 } },
      'claude-fable-5-1': { label: 'Fable 5.1', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', prices: { input: 10, output: 50, cacheRead: 0.25 } },
      'claude-sonnet-5-5': { label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', prices: { input: 2, output: 10, cacheRead: 0.1 } },
      'claude-haiku-5-5': {
        label: 'Haiku 5.5',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'medium',
        prices: { input: 0.1, output: 0.5, cacheRead: 0.01, over: { promptTokens: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 } },
      },
      'claude-fable-5': { label: 'Fable 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', prices: { input: 10, output: 50, cacheRead: 1 } },
      'claude-opus-5': { label: 'Opus 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', prices: { input: 5, output: 25, cacheRead: 0.5 } },
      'claude-sonnet-5': { label: 'Sonnet 5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', prices: { input: 2, output: 10, cacheRead: 0.2 } },
      'claude-opus-4-8': { label: 'Opus 4.8', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high', prices: { input: 5, output: 25, cacheRead: 0.5 } },
      'claude-opus-4-7': { label: 'Opus 4.7', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'xhigh', prices: { input: 5, output: 25, cacheRead: 0.5 } },
      'claude-opus-4-6': { label: 'Opus 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', prices: { input: 5, output: 25, cacheRead: 0.5 } },
      'claude-sonnet-4-6': { label: 'Sonnet 4.6', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'high', prices: { input: 3, output: 15, cacheRead: 0.3 } },
      'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', efforts: [], prices: { input: 1, output: 5, cacheRead: 0.1 } },
    } as Record<string, RegistryModel>,
  },
};

/** The registry's Claude models, as discovery would list them. */
export const registryModels = (): RuntimeModel[] =>
  Object.entries(RUNTIME_REGISTRY.claude.models).map(([id, m]) => ({
    id,
    label: m.label,
    efforts: m.efforts,
    ...(m.defaultEffort ? { defaultEffort: m.defaultEffort } : {}),
    ...(id === RUNTIME_REGISTRY.claude.default ? { default: true } : {}),
  }));

/** The effort a run on `model` gets when none was chosen. */
export const defaultEffort = (model: string): string | undefined => RUNTIME_REGISTRY.claude.models[model]?.defaultEffort;

export const EFFORT_LABEL: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
