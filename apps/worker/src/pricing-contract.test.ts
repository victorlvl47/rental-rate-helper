import { describe, expect, it } from 'vitest';
import { calculateRuleBasedPricing, stubAiPricingProvider, validateAiPricingRecommendation } from 'pricing';
import type { Property } from 'shared';

const property: Property = { id: '10000000-0000-4000-8000-000000000001', name: 'Worker fixture', city: 'New York', base_price: 100, min_price: 50, max_price: 200, bedrooms: 1, bathrooms: 1, max_guests: 2, current_occupancy_rate: 0, target_occupancy_rate: 1 };
describe('worker pricing contract', () => {
  it('uses the shared deterministic result and preserves the visible 30% rejection', async () => {
    const deterministic = calculateRuleBasedPricing(property, [{ property_id: property.id, date: '2026-09-14', competitor_avg_price: 140, local_event_score: 1, seasonality_score: 1, demand_score: 1 }]);
    const metadata = await stubAiPricingProvider.getRecommendation(deterministic);
    const validation = validateAiPricingRecommendation(property, deterministic, metadata);
    expect(validation).toEqual({ valid: false, issue_codes: ['authoritative_result_exceeds_30_percent'] });
  });
});
