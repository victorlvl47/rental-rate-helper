import { describe, expect, it } from 'vitest';

import {
  aiPricingValidationRejectionResponseSchema,
  recommendationValidationResultSchema,
} from './index.js';

const recommendation = {
  recommended_price: 104.34,
  explanation: 'The deterministic result is authoritative.',
  confidence_score: 0.8,
  risk_level: 'low',
} as const;

describe('recommendation validation contracts', () => {
  it('accepts strict discriminated valid and invalid results', () => {
    expect(
      recommendationValidationResultSchema.parse({
        valid: true,
        recommendation,
      }),
    ).toEqual({ valid: true, recommendation });

    expect(
      recommendationValidationResultSchema.parse({
        valid: false,
        issue_codes: ['blank_explanation', 'malformed_recommendation'],
      }),
    ).toEqual({
      valid: false,
      issue_codes: ['blank_explanation', 'malformed_recommendation'],
    });
  });

  it('rejects unknown issue codes, empty invalid results, and extra fields', () => {
    expect(
      recommendationValidationResultSchema.safeParse({
        valid: false,
        issue_codes: ['provider_error'],
      }).success,
    ).toBe(false);
    expect(recommendationValidationResultSchema.safeParse({ valid: false, issue_codes: [] }).success).toBe(false);
    expect(
      recommendationValidationResultSchema.safeParse({
        valid: true,
        recommendation,
        raw_provider_payload: {},
      }).success,
    ).toBe(false);
  });

  it('accepts only the safe rejection response shape', () => {
    expect(
      aiPricingValidationRejectionResponseSchema.parse({
        error: 'Recommendation rejected.',
        issue_codes: ['price_mismatch_authoritative_result'],
      }),
    ).toEqual({
      error: 'Recommendation rejected.',
      issue_codes: ['price_mismatch_authoritative_result'],
    });
    expect(
      aiPricingValidationRejectionResponseSchema.safeParse({
        error: 'Recommendation rejected.',
        issue_codes: ['malformed_recommendation'],
        details: 'provider payload',
      }).success,
    ).toBe(false);
  });
});
