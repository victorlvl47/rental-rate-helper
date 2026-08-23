import { describe, expect, it } from 'vitest';
import { ruleBasedPricingResultSchema, type MarketSignal, type Property } from 'shared';

import { calculateRuleBasedPricing } from './rule-based-pricing.js';

const property: Property = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Downtown Loft',
  city: 'New York',
  base_price: 100,
  min_price: 50,
  max_price: 200,
  bedrooms: 1,
  bathrooms: 1,
  max_guests: 2,
  current_occupancy_rate: 0.4,
  target_occupancy_rate: 0.6,
};

const signal: MarketSignal = {
  property_id: property.id,
  date: '2026-09-14',
  competitor_avg_price: 120,
  demand_score: 0.75,
  seasonality_score: 0.7,
  local_event_score: 0.6,
};

function withProperty(overrides: Partial<Property>): Property {
  return { ...property, ...overrides };
}

function withSignal(overrides: Partial<MarketSignal>): MarketSignal {
  return { ...signal, ...overrides };
}

describe('calculateRuleBasedPricing', () => {
  it('calculates every adjustment, their additive total, and a cents-rounded range', () => {
    const result = calculateRuleBasedPricing(property, [signal]);

    expect(result.adjustments.occupancy).toBeCloseTo(0.04);
    expect(result.adjustments.demand).toBeCloseTo(0.05);
    expect(result.adjustments.competitor).toBeCloseTo(0.1);
    expect(result.adjustments.seasonality).toBeCloseTo(0.02);
    expect(result.adjustments.local_event).toBeCloseTo(0.01);
    expect(result.adjustments.total).toBeCloseTo(0.22);
    expect(result).toMatchObject({
      signal_count: 1,
      market_signals_used: true,
      minimum_recommended_price: 115.9,
      recommended_price: 122,
      maximum_recommended_price: 128.1,
    });
  });

  it('caps combined adjustments at both policy limits', () => {
    const positive = calculateRuleBasedPricing(
      withProperty({ current_occupancy_rate: 0, target_occupancy_rate: 1 }),
      [withSignal({ competitor_avg_price: 200, demand_score: 1, seasonality_score: 1, local_event_score: 1 })],
    );
    const negative = calculateRuleBasedPricing(
      withProperty({ current_occupancy_rate: 1, target_occupancy_rate: 0 }),
      [withSignal({ competitor_avg_price: 0, demand_score: 0, seasonality_score: 0, local_event_score: 0 })],
    );

    expect(positive.adjustments.total).toBe(0.35);
    expect(negative.adjustments.total).toBe(-0.35);
  });

  it('clamps the competitor adjustment at its bounds', () => {
    const neutralOccupancy = withProperty({ current_occupancy_rate: 0.5, target_occupancy_rate: 0.5 });

    expect(
      calculateRuleBasedPricing(neutralOccupancy, [withSignal({ competitor_avg_price: 200 })]).adjustments.competitor,
    ).toBe(0.1);
    expect(
      calculateRuleBasedPricing(neutralOccupancy, [withSignal({ competitor_avg_price: 0 })]).adjustments.competitor,
    ).toBe(-0.1);
  });

  it('uses a zero competitor adjustment without dividing by zero for a zero base price', () => {
    const zeroBaseProperty = withProperty({ base_price: 0, min_price: 0 });
    const result = calculateRuleBasedPricing(zeroBaseProperty, [withSignal({ competitor_avg_price: 99.99 })]);

    expect(result.adjustments.competitor).toBe(0);
    expect(result.recommended_price).toBe(0);
  });

  it('rounds output prices to cents using numeric arithmetic', () => {
    const result = calculateRuleBasedPricing(
      withProperty({
        base_price: 100.05,
        current_occupancy_rate: 0.5,
        target_occupancy_rate: 0.75,
      }),
      [],
    );

    expect(result).toMatchObject({
      minimum_recommended_price: 99.8,
      recommended_price: 105.05,
      maximum_recommended_price: 110.31,
    });
  });

  it('clamps only the lower end of the pricing range to the property minimum', () => {
    const result = calculateRuleBasedPricing(withProperty({ min_price: 120, max_price: 200 }), [signal]);

    expect(result).toMatchObject({
      minimum_recommended_price: 120,
      recommended_price: 122,
      maximum_recommended_price: 128.1,
    });
  });

  it('clamps only the upper end of the pricing range to the property maximum', () => {
    const result = calculateRuleBasedPricing(withProperty({ min_price: 50, max_price: 124 }), [signal]);

    expect(result).toMatchObject({
      minimum_recommended_price: 115.9,
      recommended_price: 122,
      maximum_recommended_price: 124,
    });
  });

  it('keeps every output price within property bounds, including a collapsed range', () => {
    const result = calculateRuleBasedPricing(
      withProperty({ min_price: 100, max_price: 100, current_occupancy_rate: 0, target_occupancy_rate: 1 }),
      [signal],
    );

    expect(result.minimum_recommended_price).toBe(100);
    expect(result.recommended_price).toBe(100);
    expect(result.maximum_recommended_price).toBe(100);
    expect(result.minimum_recommended_price).toBeGreaterThanOrEqual(100);
    expect(result.maximum_recommended_price).toBeLessThanOrEqual(100);
  });

  it('uses the documented occupancy-only fallback for no signals', () => {
    const result = calculateRuleBasedPricing(property, []);

    expect(result.signal_count).toBe(0);
    expect(result.market_signals_used).toBe(false);
    expect(result.adjustments.occupancy).toBeCloseTo(0.04);
    expect(result.adjustments.demand).toBe(0);
    expect(result.adjustments.competitor).toBe(0);
    expect(result.adjustments.seasonality).toBe(0);
    expect(result.adjustments.local_event).toBe(0);
    expect(result.adjustments.total).toBeCloseTo(0.04);
  });

  it('returns the same result for equivalent signals in a different order', () => {
    const otherSignal = withSignal({
      date: '2026-09-15',
      competitor_avg_price: 80,
      demand_score: 0.25,
      seasonality_score: 0.3,
      local_event_score: 0.4,
    });

    expect(calculateRuleBasedPricing(property, [signal, otherSignal])).toEqual(
      calculateRuleBasedPricing(property, [otherSignal, signal]),
    );
  });

  it('rejects programmer-invalid signals for a different property', () => {
    expect(() =>
      calculateRuleBasedPricing(property, [withSignal({ property_id: '660e8400-e29b-41d4-a716-446655440000' })]),
    ).toThrow('Every market signal must belong to the supplied property.');
  });

  it('returns an output that parses with the shared result contract and contains no explanation', () => {
    const result = calculateRuleBasedPricing(property, [signal]);

    expect(ruleBasedPricingResultSchema.parse(result)).toEqual(result);
    expect(result).not.toHaveProperty('explanation');
  });
});
