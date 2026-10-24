import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

export const PROVIDERS = ['google', 'openrouter'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  google: 'gemini-3.8-flash',
  openrouter: 'google/gemini-3.8-flash',
};

export interface ModelSelection {
  provider: ProviderName;
  modelId: string;
  model: LanguageModel;
}

export interface ModelOptions {
  provider: ProviderName;
  /** Empty string means the provider's default model. */
  model: string;
  apiKey: string;
}

/** Builds the AI SDK language model for the configured provider. */
export function createModel(options: ModelOptions): ModelSelection {
  const modelId = options.model || DEFAULT_MODELS[options.provider];
  switch (options.provider) {
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: options.apiKey });
      return { provider: 'google', modelId, model: google(modelId) };
    }
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey: options.apiKey });
      // usage.include makes OpenRouter report the real cost in providerMetadata.
      return {
        provider: 'openrouter',
        modelId,
        model: openrouter(modelId, { usage: { include: true } }),
      };
    }
  }
}
