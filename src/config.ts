import { DEFAULT_MODELS, PROVIDERS, type ProviderName } from './agent/model.js';
import { parsePathList } from './context.js';
import { FAIL_ON, type FailOn } from './exit.js';

export const DEFAULT_CRITERIA_FILE = '.github/ai-review-criteria.md';
export const DEFAULT_MAX_DIFF_CHARS = 120_000;
const MIN_DIFF_CHARS = 1_000;

export interface ActionConfig {
  provider: ProviderName;
  geminiApiKey: string;
  openrouterApiKey: string;
  githubToken: string;
  /** Resolved model id (provider default when the input is empty). */
  model: string;
  criteriaFile: string;
  contextFiles: string[];
  failOn: FailOn;
  maxDiffChars: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function parseFailOn(value: string): FailOn {
  const normalized = value.trim();
  const match = FAIL_ON.find((v) => v.toLowerCase() === normalized.toLowerCase());
  if (!match) {
    throw new ConfigError(`Invalid fail-on "${value}". Expected one of: ${FAIL_ON.join(', ')}.`);
  }
  return match;
}

export function parseProvider(value: string): ProviderName {
  const normalized = value.trim().toLowerCase() || 'google';
  const match = PROVIDERS.find((p) => p === normalized);
  if (!match) {
    throw new ConfigError(`Invalid provider "${value}". Expected one of: ${PROVIDERS.join(', ')}.`);
  }
  return match;
}

export function parseMaxDiffChars(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return DEFAULT_MAX_DIFF_CHARS;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < MIN_DIFF_CHARS) {
    throw new ConfigError(
      `Invalid max-diff-chars "${value}". Expected an integer >= ${MIN_DIFF_CHARS}.`,
    );
  }
  return n;
}

/** Reads and validates the Action inputs. `getInput` returns '' for unset inputs. */
export function parseInputs(getInput: (name: string) => string): ActionConfig {
  const provider = parseProvider(getInput('provider'));
  return {
    provider,
    geminiApiKey: getInput('gemini-api-key').trim(),
    openrouterApiKey: getInput('openrouter-api-key').trim(),
    githubToken: getInput('github-token').trim(),
    model: getInput('model').trim() || DEFAULT_MODELS[provider],
    criteriaFile: getInput('criteria-file').trim() || DEFAULT_CRITERIA_FILE,
    contextFiles: parsePathList(getInput('context-files')),
    failOn: parseFailOn(getInput('fail-on') || 'DECLINED'),
    maxDiffChars: parseMaxDiffChars(getInput('max-diff-chars')),
  };
}

const FORK_NOTE = 'Secrets are not available to workflows triggered by pull requests from forks.';

/** Checks that the keys required by the configuration are present. */
export function assertApiKeys(config: ActionConfig): void {
  if (!config.geminiApiKey) {
    throw new ConfigError(
      'Input "gemini-api-key" is empty. Create a repository secret GEMINI_API_KEY (Google AI Studio key) ' +
        'and pass it as `gemini-api-key: ${{ secrets.GEMINI_API_KEY }}`. ' +
        FORK_NOTE,
    );
  }
  if (config.provider === 'openrouter' && !config.openrouterApiKey) {
    throw new ConfigError(
      'provider is "openrouter" but input "openrouter-api-key" is empty. Pass it from a secret, ' +
        'e.g. `openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}`. ' +
        FORK_NOTE,
    );
  }
}

export function apiKeyFor(config: ActionConfig): string {
  return config.provider === 'openrouter' ? config.openrouterApiKey : config.geminiApiKey;
}
