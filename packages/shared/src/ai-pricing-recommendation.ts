import { z } from 'zod';

import { ruleBasedPricingResultSchema } from './rule-based-pricing.js';
import { usdAmountSchema } from './rental-market.js';

export const aiPricingRecommendationSchema = z
  .object({
    recommended_price: usdAmountSchema,
    explanation: z.string().trim().min(1),
    confidence_score: z.number().finite().min(0).max(1),
    risk_level: z.enum(['low', 'medium', 'high']),
  })
  .strict();

export type AiPricingRecommendation = z.infer<typeof aiPricingRecommendationSchema>;

/**
 * Preview output retaining the deterministic rule-based result as the
 * authoritative pricing output. The AI recommendation is separate metadata
 * and consumers must not replace the deterministic result with it.
 */
export const aiPricingPreviewResponseSchema = z
  .object({
    rule_based_pricing: ruleBasedPricingResultSchema,
    ai_recommendation: aiPricingRecommendationSchema,
  })
  .strict();

export type AiPricingPreviewResponse = z.infer<typeof aiPricingPreviewResponseSchema>;
