import { describe, expect, it } from 'vitest';

import { aiPricingPreviewResponseSchema, aiPricingRecommendationSchema } from './index.js';

const ruleBasedPricingResult = {
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

const aiRecommendation = {
  recommended_price: 104.34,
  explanation: 'Demand and competitor pricing support a modest increase.',
  confidence_score: 0.8,
  risk_level: 'low',
} as const;

describe('AI pricing recommendation contract', () => {
  it('accepts a valid numeric USD recommendation and every allowed risk level', () => {
    for (const risk_level of ['low', 'medium', 'high'] as const) {
      expect(
        aiPricingRecommendationSchema.safeParse({ ...aiRecommendation, risk_level }).success,
      ).toBe(true);
    }
  });

  it('accepts inclusive confidence-score boundaries', () => {
    expect(aiPricingRecommendationSchema.safeParse({ ...aiRecommendation, confidence_score: 0 }).success).toBe(true);
    expect(aiPricingRecommendationSchema.safeParse({ ...aiRecommendation, confidence_score: 1 }).success).toBe(true);
  });

  it('reuses USD amount validation for recommended_price', () => {
    for (const recommended_price of ['104.34', 104.345, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(aiPricingRecommendationSchema.safeParse({ ...aiRecommendation, recommended_price }).success).toBe(false);
    }
  });

  it('requires all fields and rejects unknown fields', () => {
    expect(
      aiPricingRecommendationSchema.safeParse({
        recommended_price: aiRecommendation.recommended_price,
        explanation: aiRecommendation.explanation,
        confidence_score: aiRecommendation.confidence_score,
      }).success,
    ).toBe(false);
    expect(aiPricingRecommendationSchema.safeParse({ ...aiRecommendation, provider: 'stub' }).success).toBe(false);
  });

  it('rejects blank explanations, invalid confidence scores, and unsupported risks', () => {
    for (const invalidRecommendation of [
      { ...aiRecommendation, explanation: '' },
      { ...aiRecommendation, explanation: '   ' },
      { ...aiRecommendation, confidence_score: -0.01 },
      { ...aiRecommendation, confidence_score: 1.01 },
      { ...aiRecommendation, confidence_score: '0.8' },
      { ...aiRecommendation, confidence_score: Number.NaN },
      { ...aiRecommendation, confidence_score: Number.POSITIVE_INFINITY },
      { ...aiRecommendation, confidence_score: Number.NEGATIVE_INFINITY },
      { ...aiRecommendation, risk_level: 'critical' },
    ]) {
      expect(aiPricingRecommendationSchema.safeParse(invalidRecommendation).success).toBe(false);
    }
  });
});

describe('AI pricing preview response contract', () => {
  it('accepts a complete deterministic result and separate AI recommendation', () => {
    const response = {
      rule_based_pricing: ruleBasedPricingResult,
      ai_recommendation: aiRecommendation,
    };

    expect(aiPricingPreviewResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects malformed or incomplete deterministic results and extra response fields', () => {
    expect(
      aiPricingPreviewResponseSchema.safeParse({
        rule_based_pricing: { ...ruleBasedPricingResult, recommended_price: 104.345 },
        ai_recommendation: aiRecommendation,
      }).success,
    ).toBe(false);
    expect(
      aiPricingPreviewResponseSchema.safeParse({
        rule_based_pricing: { ...ruleBasedPricingResult, adjustments: undefined },
        ai_recommendation: aiRecommendation,
      }).success,
    ).toBe(false);
    expect(
      aiPricingPreviewResponseSchema.safeParse({
        rule_based_pricing: ruleBasedPricingResult,
        ai_recommendation: aiRecommendation,
        request_id: 'preview-1',
      }).success,
    ).toBe(false);
  });
});
