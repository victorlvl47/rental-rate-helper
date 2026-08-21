import type { AiPricingProvider } from './ai-pricing-provider.js';
import { stubAiPricingProvider } from './stub-ai-pricing-provider.js';

export type AiProviderEnvironment = Readonly<Record<string, string | undefined>>;

export type AiProviderConfig =
  | { provider: 'stub' }
  | { provider: 'openai'; openaiApiKey: string; openaiModel?: string };

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

/**
 * Selects the local stub today. The OpenAI branch is intentionally reserved
 * for the real provider that will be introduced in Issue 18.
 */
export function createAiPricingProvider(environment: AiProviderEnvironment = process.env): AiPricingProvider {
  const config = parseAiProviderConfig(environment);

  if (config.provider === 'stub') {
    return stubAiPricingProvider;
  }

  throw new Error('The OpenAI pricing provider is not available yet.');
}
