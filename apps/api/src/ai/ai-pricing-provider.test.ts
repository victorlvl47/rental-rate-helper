import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiPricingRecommendationSchema, type RuleBasedPricingResult } from 'shared';

import { createAiPricingProvider, parseAiProviderConfig } from './config.js';
import { stubAiPricingProvider } from './stub-ai-pricing-provider.js';

const ruleBasedPricing: RuleBasedPricingResult = {
  property_id: '550e8400-e29b-41d4-a716-446655440000',
  signal_count: 2,
  market_signals_used: true,
  base_price: 100.5,
  minimum_recommended_price: 99.12,
  recommended_price: 104.34,
  maximum_recommended_price: 109.56,
  adjustments: {
    occupancy: 0.01,
    demand: 0.04,
    competitor: 0.02,
    seasonality: -0.01,
    local_event: 0.03,
    total: 0.09,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stub AI pricing provider', () => {
  it('returns a stable shared recommendation derived from the deterministic result', async () => {
    const first = await stubAiPricingProvider.getRecommendation(ruleBasedPricing);
    const second = await stubAiPricingProvider.getRecommendation(ruleBasedPricing);

    expect(first).toEqual(second);
    expect(aiPricingRecommendationSchema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      recommended_price: ruleBasedPricing.recommended_price,
      confidence_score: 0.8,
      risk_level: 'low',
    });
    expect(first.explanation).toContain(String(ruleBasedPricing.signal_count));
  });

  it('requires no API key and does not make network calls', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const provider = createAiPricingProvider({});
    await provider.getRecommendation(ruleBasedPricing);

    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AI provider configuration', () => {
  it('defaults to the stub through a passed environment object', () => {
    expect(parseAiProviderConfig({})).toEqual({ provider: 'stub' });
    expect(createAiPricingProvider({})).toBe(stubAiPricingProvider);
  });

  it('requires a non-blank OpenAI key without exposing supplied secret values', () => {
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY');
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: '   ' })).toThrow('OPENAI_API_KEY');

    const testSecret = 'test-secret-that-must-not-appear';
    expect(() => createAiPricingProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: testSecret })).toThrow(
      'not available yet',
    );
    try {
      createAiPricingProvider({ AI_PROVIDER: 'openai', OPENAI_API_KEY: testSecret });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(testSecret);
    }
  });

  it('accepts reserved OpenAI configuration without mutating process.env', () => {
    expect(
      parseAiProviderConfig({
        AI_PROVIDER: 'openai',
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-test',
      }),
    ).toEqual({ provider: 'openai', openaiApiKey: 'test-key', openaiModel: 'gpt-test' });
    expect(() => parseAiProviderConfig({ AI_PROVIDER: 'unsupported' })).toThrow('AI_PROVIDER');
  });
});
