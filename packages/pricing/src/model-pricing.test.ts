import { describe, expect, it } from 'vitest';
import { estimateOpenAiCostUsd } from './model-pricing.js';

describe('local OpenAI pricing table', () => {
  it('calculates a known model cost and leaves unsupported models unknown', () => {
    expect(estimateOpenAiCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBe(0.75);
    expect(estimateOpenAiCostUsd('unknown-model', 10, 20)).toBeNull();
    expect(estimateOpenAiCostUsd('gpt-4o-mini', null, 20)).toBeNull();
  });
});
