import type { AiPricingProvider } from './ai-pricing-provider.js';
import { createOpenAiPricingProvider, type FetchLike } from './openai-ai-pricing-provider.js';
import { stubAiPricingProvider } from './stub-ai-pricing-provider.js';

export type AiProviderEnvironment = Readonly<Record<string, string | undefined>>;

export type AiProviderConfig =
  | { provider: 'stub' }
  | { provider: 'openai'; openaiApiKey: string; openaiModel?: string };

export interface AiPricingProviderDependencies {
  fetch?: FetchLike;
}

export function parseAiProviderConfig(environment: AiProviderEnvironment = process.env): AiProviderConfig {
  const provider = environment.AI_PROVIDER;

  if (provider === undefined || provider === 'stub') {
    return { provider: 'stub' };
  }

  if (provider !== 'openai') {
    throw new Error('AI_PROVIDER must be either "stub" or "openai".');
  }

  const openaiApiKey = environment.OPENAI_API_KEY?.trim();

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY must be configured when AI_PROVIDER is "openai".');
  }

  const openaiModel = environment.OPENAI_MODEL?.trim();

  return {
    provider: 'openai',
    openaiApiKey,
    ...(openaiModel ? { openaiModel } : {}),
  };
}

export function createAiPricingProvider(
  environment: AiProviderEnvironment = process.env,
  dependencies: AiPricingProviderDependencies = {},
): AiPricingProvider {
  const config = parseAiProviderConfig(environment);

  if (config.provider === 'stub') {
    return stubAiPricingProvider;
  }

  return createOpenAiPricingProvider({
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    fetch: dependencies.fetch,
  });
}
