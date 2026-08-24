import { z } from 'zod';

import { aiPricingRecommendationSchema } from './ai-pricing-recommendation.js';

export const recommendationValidationIssueCodeSchema = z.enum([
  'malformed_recommendation',
  'blank_explanation',
  'invalid_confidence_score',
  'unsupported_risk_level',
  'price_outside_property_bounds',
  'price_outside_deterministic_range',
  'price_mismatch_authoritative_result',
  'price_increase_exceeds_30_percent',
  'authoritative_result_exceeds_30_percent',
]);

export type RecommendationValidationIssueCode = z.infer<typeof recommendationValidationIssueCodeSchema>;

export const recommendationValidationResultSchema = z.discriminatedUnion('valid', [
  z
    .object({
      valid: z.literal(true),
      recommendation: aiPricingRecommendationSchema,
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      issue_codes: z.array(recommendationValidationIssueCodeSchema).min(1),
    })
    .strict(),
]);

export type RecommendationValidationResult = z.infer<typeof recommendationValidationResultSchema>;

export const aiPricingValidationRejectionResponseSchema = z
  .object({
    error: z.literal('Recommendation rejected.'),
    issue_codes: z.array(recommendationValidationIssueCodeSchema).min(1),
  })
  .strict();

export type AiPricingValidationRejectionResponse = z.infer<typeof aiPricingValidationRejectionResponseSchema>;
