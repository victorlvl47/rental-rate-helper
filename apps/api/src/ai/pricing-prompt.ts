import type { RuleBasedPricingResult } from 'shared';

function formatUsd(value: number): string {
  return `$${value.toFixed(2)} USD`;
}

function formatAdjustment(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Builds the complete, authoritative deterministic context for an AI pricing
 * explanation. This function deliberately does not calculate any pricing.
 */
export function buildPricingPrompt(ruleBasedPricing: RuleBasedPricingResult): string {
  const { adjustments } = ruleBasedPricing;

  return `You provide explanation metadata for an authoritative deterministic rental-pricing result.

All supplied deterministic prices, range, signal information, and adjustments are authoritative. Money values are USD. Do not invent, calculate, widen, narrow, or override a pricing range. Return the supplied deterministic recommended_price exactly unchanged.

Authoritative deterministic context:
- Property identifier: ${ruleBasedPricing.property_id}
- USD base price: ${formatUsd(ruleBasedPricing.base_price)}
- Minimum recommended price: ${formatUsd(ruleBasedPricing.minimum_recommended_price)}
- Deterministic recommended price: ${formatUsd(ruleBasedPricing.recommended_price)}
- Maximum recommended price: ${formatUsd(ruleBasedPricing.maximum_recommended_price)}
- Signal count: ${ruleBasedPricing.signal_count}
- Market signals used: ${ruleBasedPricing.market_signals_used ? 'true' : 'false'}
- Authoritative adjustment breakdown:
  - Occupancy: ${formatAdjustment(adjustments.occupancy)}
  - Demand: ${formatAdjustment(adjustments.demand)}
  - Competitor: ${formatAdjustment(adjustments.competitor)}
  - Seasonality: ${formatAdjustment(adjustments.seasonality)}
  - Local event: ${formatAdjustment(adjustments.local_event)}
  - Total adjustment: ${formatAdjustment(adjustments.total)}

Return exactly these structured fields and no others:
- recommended_price: the supplied deterministic recommended_price unchanged
- explanation: a non-blank explanation of the authoritative result
- confidence_score: a number from 0 through 1
- risk_level: one of low, medium, or high`;
}
