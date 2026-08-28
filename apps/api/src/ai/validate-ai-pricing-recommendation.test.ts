import { describe, expect, it } from 'vitest';

import { propertySchema, ruleBasedPricingResultSchema } from 'shared';

import { validateAiPricingRecommendation } from './validate-ai-pricing-recommendation.js';

const property = propertySchema.parse({
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Validation Studio',
  city: 'New York',
  base_price: 100,
  min_price: 80,
  max_price: 150,
  bedrooms: 1,
  bathrooms: 1,
  max_guests: 2,
  current_occupancy_rate: 0.5,
  target_occupancy_rate: 0.5,
});

const ruleBasedPricing = ruleBasedPricingResultSchema.parse({
  property_id: property.id,
  signal_count: 1,
  market_signals_used: true,
  base_price: property.base_price,
  minimum_recommended_price: 95,
  recommended_price: 100,
  maximum_recommended_price: 105,
  adjustments: {
    occupancy: 0,
    demand: 0,
    competitor: 0,
    seasonality: 0,
    local_event: 0,
    total: 0,
  },
});

const validRecommendation = {
  recommended_price: 100,
  explanation: 'The deterministic price is within the established range.',
  confidence_score: 0.8,
  risk_level: 'low',
};

function invalidCodes(output: unknown) {
  const result = validateAiPricingRecommendation(property, ruleBasedPricing, output);

  expect(result.valid).toBe(false);
  return result.valid ? [] : result.issue_codes;
}

describe('validateAiPricingRecommendation', () => {
  it('accepts schema-valid metadata with the exact authoritative price', () => {
    expect(validateAiPricingRecommendation(property, ruleBasedPricing, validRecommendation)).toEqual({
      valid: true,
      recommendation: validRecommendation,
    });
  });

  it.each([
    ['malformed output', undefined, 'malformed_recommendation'],
    ['blank explanation', { ...validRecommendation, explanation: '   ' }, 'blank_explanation'],
    ['invalid confidence', { ...validRecommendation, confidence_score: 1.01 }, 'invalid_confidence_score'],
    ['unsupported risk', { ...validRecommendation, risk_level: 'critical' }, 'unsupported_risk_level'],
  ])('classifies %s without returning provider details', (_name, output, expectedCode) => {
    expect(invalidCodes(output)).toContain(expectedCode);
  });

  it('classifies a property-bound violation', () => {
    expect(invalidCodes({ ...validRecommendation, recommended_price: 200 })).toContain('price_outside_property_bounds');
  });

  it('classifies a deterministic safe-range violation', () => {
    expect(invalidCodes({ ...validRecommendation, recommended_price: 110 })).toContain('price_outside_deterministic_range');
  });

  it('classifies a price that is inside the safe range but differs from the authoritative price', () => {
    expect(invalidCodes({ ...validRecommendation, recommended_price: 101 })).toEqual([
      'price_mismatch_authoritative_result',
    ]);
  });

  it('classifies an AI price increase above the 30% business limit', () => {
    const wideRange = ruleBasedPricingResultSchema.parse({
      ...ruleBasedPricing,
      minimum_recommended_price: 95,
      recommended_price: 100,
      maximum_recommended_price: 150,
    });

    expect(
      validateAiPricingRecommendation(property, wideRange, {
        ...validRecommendation,
        recommended_price: 131,
      }),
    ).toMatchObject({
      valid: false,
      issue_codes: expect.arrayContaining([
        'price_mismatch_authoritative_result',
        'price_increase_exceeds_30_percent',
      ]),
    });
  });

  it('classifies an authoritative deterministic result above the 30% business limit without changing it', () => {
    const policyConflict = ruleBasedPricingResultSchema.parse({
      ...ruleBasedPricing,
      minimum_recommended_price: 128.25,
      recommended_price: 135,
      maximum_recommended_price: 141.75,
      adjustments: { ...ruleBasedPricing.adjustments, total: 0.35 },
    });
    const recommendation = { ...validRecommendation, recommended_price: 135 };

    expect(validateAiPricingRecommendation(property, policyConflict, recommendation)).toEqual({
      valid: false,
      issue_codes: ['authoritative_result_exceeds_30_percent'],
    });
    expect(policyConflict.recommended_price).toBe(135);
  });
});
