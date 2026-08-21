import type { AiPricingRecommendation, RuleBasedPricingResult } from 'shared';

/**
 * Produces AI recommendation metadata from an authoritative deterministic
 * pricing result. It must not recalculate or replace that result.
 */
export interface AiPricingProvider {
  getRecommendation(ruleBasedPricing: RuleBasedPricingResult): Promise<AiPricingRecommendation>;
}
