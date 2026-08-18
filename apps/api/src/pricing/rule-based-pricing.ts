import {
  ruleBasedPricingResultSchema,
  type MarketSignal,
  type Property,
  type RuleBasedPricingResult,
} from 'shared';

const MINIMUM_TOTAL_ADJUSTMENT = -0.35;
const MAXIMUM_TOTAL_ADJUSTMENT = 0.35;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundUsdAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function average(signals: readonly MarketSignal[], select: (signal: MarketSignal) => number): number {
  return signals.reduce((sum, signal) => sum + select(signal), 0) / signals.length;
}

/**
 * Calculates a deterministic, read-only pricing result without I/O. Signals
 * belonging to another property are programmer-invalid input and are rejected.
 */
export function calculateRuleBasedPricing(
  property: Property,
  signals: readonly MarketSignal[],
): RuleBasedPricingResult {
  if (signals.some((signal) => signal.property_id !== property.id)) {
    throw new Error('Every market signal must belong to the supplied property.');
  }

  const occupancy = (property.target_occupancy_rate - property.current_occupancy_rate) * 0.2;
  const marketSignalsUsed = signals.length > 0;
  const demand = marketSignalsUsed ? (average(signals, (signal) => signal.demand_score) - 0.5) * 0.2 : 0;
  const competitor =
    marketSignalsUsed && property.base_price > 0
      ? clamp(
          (average(signals, (signal) => signal.competitor_avg_price) - property.base_price) /
            property.base_price,
          -0.2,
          0.2,
        ) * 0.5
      : 0;
  const seasonality = marketSignalsUsed
    ? (average(signals, (signal) => signal.seasonality_score) - 0.5) * 0.1
    : 0;
  const localEvent = marketSignalsUsed
    ? (average(signals, (signal) => signal.local_event_score) - 0.5) * 0.1
    : 0;
  const total = clamp(
    occupancy + demand + competitor + seasonality + localEvent,
    MINIMUM_TOTAL_ADJUSTMENT,
    MAXIMUM_TOTAL_ADJUSTMENT,
  );
  const rawRecommendedPrice = property.base_price * (1 + total);

  const minimumRecommendedPrice = roundUsdAmount(
    clamp(rawRecommendedPrice * 0.95, property.min_price, property.max_price),
  );
  const recommendedPrice = roundUsdAmount(
    clamp(rawRecommendedPrice, property.min_price, property.max_price),
  );
  const maximumRecommendedPrice = roundUsdAmount(
    clamp(rawRecommendedPrice * 1.05, property.min_price, property.max_price),
  );

  return ruleBasedPricingResultSchema.parse({
    property_id: property.id,
    signal_count: signals.length,
    market_signals_used: marketSignalsUsed,
    base_price: property.base_price,
    minimum_recommended_price: minimumRecommendedPrice,
    recommended_price: recommendedPrice,
    maximum_recommended_price: maximumRecommendedPrice,
    adjustments: {
      occupancy,
      demand,
      competitor,
      seasonality,
      local_event: localEvent,
      total,
    },
  });
}
