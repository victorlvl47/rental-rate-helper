import { describe, expect, it, vi } from 'vitest';
import { createConfiguredAiPricingProvider, stubAiPricingProvider } from './index.js';

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
