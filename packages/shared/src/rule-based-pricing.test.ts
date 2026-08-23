import { describe, expect, it } from 'vitest';

import { ruleBasedPricingResultSchema } from './index.js';

const result = {
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

describe('rule-based pricing result contract', () => {
  it('accepts a fully valid cents-rounded result', () => {
    expect(ruleBasedPricingResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts the empty-signal occupancy-only fallback', () => {
    expect(
      ruleBasedPricingResultSchema.safeParse({
        ...result,
        signal_count: 0,
        market_signals_used: false,
        adjustments: {
          ...result.adjustments,
          demand: 0,
          competitor: 0,
          seasonality: 0,
          local_event: 0,
          total: 0.01,
        },
      }).success,
    ).toBe(true);
  });

  it('requires numeric USD values and a valid property UUID', () => {
    expect(ruleBasedPricingResultSchema.safeParse({ ...result, base_price: '100.50' }).success).toBe(false);
    expect(ruleBasedPricingResultSchema.safeParse({ ...result, recommended_price: 104.345 }).success).toBe(false);
    expect(ruleBasedPricingResultSchema.safeParse({ ...result, property_id: 'not-a-uuid' }).success).toBe(false);
  });

  it('requires a non-negative integer signal count with a matching signal flag', () => {
    for (const invalidResult of [
      { ...result, signal_count: -1 },
      { ...result, signal_count: 1.5 },
      { ...result, signal_count: 0, market_signals_used: true },
      { ...result, signal_count: 1, market_signals_used: false },
    ]) {
      expect(ruleBasedPricingResultSchema.safeParse(invalidResult).success).toBe(false);
    }
  });

  it('enforces adjustment policy bounds', () => {
    for (const adjustments of [
      { ...result.adjustments, occupancy: 0.21 },
      { ...result.adjustments, demand: -0.11 },
      { ...result.adjustments, competitor: 0.11 },
      { ...result.adjustments, seasonality: -0.06 },
      { ...result.adjustments, local_event: 0.06 },
      { ...result.adjustments, total: 0.36 },
      { ...result.adjustments, total: -0.36 },
    ]) {
      expect(ruleBasedPricingResultSchema.safeParse({ ...result, adjustments }).success).toBe(false);
    }
  });

  it('enforces the final cents-rounded price range ordering', () => {
    expect(
      ruleBasedPricingResultSchema.safeParse({
        ...result,
        minimum_recommended_price: 104.35,
      }).success,
    ).toBe(false);
    expect(
      ruleBasedPricingResultSchema.safeParse({
        ...result,
        maximum_recommended_price: 104.33,
      }).success,
    ).toBe(false);
  });

  it('rejects unexpected result and adjustment fields', () => {
    expect(ruleBasedPricingResultSchema.safeParse({ ...result, currency: 'USD' }).success).toBe(false);
    expect(
      ruleBasedPricingResultSchema.safeParse({
        ...result,
        adjustments: { ...result.adjustments, extra: 0 },
      }).success,
    ).toBe(false);
  });
});
