import { aiPricingRecommendationSchema, type RuleBasedPricingResult } from 'shared';

import type { AiPricingProvider } from './ai-pricing-provider.js';

export const stubAiPricingProvider: AiPricingProvider = {
  async getRecommendation(ruleBasedPricing: RuleBasedPricingResult) {
    const hasMarketSignals = ruleBasedPricing.market_signals_used;

    return aiPricingRecommendationSchema.parse({
      recommended_price: ruleBasedPricing.recommended_price,
      explanation: hasMarketSignals
        ? `The deterministic price uses ${ruleBasedPricing.signal_count} market signals.`
        : 'The deterministic price uses the occupancy-only fallback because no market signals are available.',
      confidence_score: hasMarketSignals ? 0.8 : 0.6,
      risk_level: hasMarketSignals ? 'low' : 'medium',
    });
  },
};
