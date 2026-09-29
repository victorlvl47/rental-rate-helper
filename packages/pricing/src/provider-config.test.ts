import { describe, expect, it, vi } from 'vitest';
import { createConfiguredAiPricingProvider, getProviderFailureMetrics, stubAiPricingProvider } from './index.js';
import type { RuleBasedPricingResult } from 'shared';

const deterministic: RuleBasedPricingResult = { property_id: '10000000-0000-4000-8000-000000000001', signal_count: 0, market_signals_used: false, base_price: 100, minimum_recommended_price: 95, recommended_price: 100, maximum_recommended_price: 105, adjustments: { occupancy: 0, demand: 0, competitor: 0, seasonality: 0, local_event: 0, total: 0 } };

describe('configured provider selection', () => {
  it('selects the deterministic stub by default', () => {
    expect(createConfiguredAiPricingProvider({ environment: {} })).toBe(stubAiPricingProvider);
  });
  it('selects OpenAI without making a network request', () => {
    const fetch = vi.fn();
    const provider = createConfiguredAiPricingProvider({ environment: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, fetch });
    expect(provider).not.toBe(stubAiPricingProvider);
    expect(fetch).not.toHaveBeenCalled();
  });
});

  it('extracts known usage from a failed OpenAI response', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 }, output: [] }) }));
    const provider = createConfiguredAiPricingProvider({ environment: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, fetch });
    await expect(provider.getRecommendationWithMetrics!(deterministic)).rejects.toSatisfy((error: unknown) => getProviderFailureMetrics(error)?.estimated_cost_usd === 0.75);
  });
