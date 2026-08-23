import { z } from 'zod';

import { usdAmountSchema } from './rental-market.js';

const adjustmentPercentageSchema = z.number().finite();

const ruleBasedPricingAdjustmentsSchema = z
  .object({
    occupancy: adjustmentPercentageSchema.min(-0.2).max(0.2),
    demand: adjustmentPercentageSchema.min(-0.1).max(0.1),
    competitor: adjustmentPercentageSchema.min(-0.1).max(0.1),
    seasonality: adjustmentPercentageSchema.min(-0.05).max(0.05),
    local_event: adjustmentPercentageSchema.min(-0.05).max(0.05),
    total: adjustmentPercentageSchema.min(-0.35).max(0.35),
  })
  .strict();

/**
 * Read-only output of a deterministic pricing calculation. This is neither a
 * persisted recommendation nor an AI-generated response.
 */
export const ruleBasedPricingResultSchema = z
  .object({
    property_id: z.uuid(),
    signal_count: z.number().int().min(0),
    market_signals_used: z.boolean(),
    base_price: usdAmountSchema,
    minimum_recommended_price: usdAmountSchema,
    recommended_price: usdAmountSchema,
    maximum_recommended_price: usdAmountSchema,
    adjustments: ruleBasedPricingAdjustmentsSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.minimum_recommended_price > result.recommended_price) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minimum_recommended_price must be less than or equal to recommended_price.',
        path: ['minimum_recommended_price'],
      });
    }

    if (result.recommended_price > result.maximum_recommended_price) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recommended_price must be less than or equal to maximum_recommended_price.',
        path: ['recommended_price'],
      });
    }

    if (result.signal_count === 0 && result.market_signals_used) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'market_signals_used must be false when signal_count is zero.',
        path: ['market_signals_used'],
      });
    }

    if (result.signal_count > 0 && !result.market_signals_used) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'market_signals_used must be true when signal_count is greater than zero.',
        path: ['market_signals_used'],
      });
    }
  });

export type RuleBasedPricingResult = z.infer<typeof ruleBasedPricingResultSchema>;
