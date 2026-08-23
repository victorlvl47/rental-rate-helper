import { describe, expect, it } from 'vitest';
import type { RuleBasedPricingResult } from 'shared';

import { buildPricingPrompt } from './pricing-prompt.js';

const ruleBasedPricing: RuleBasedPricingResult = {
  property_id: '550e8400-e29b-41d4-a716-446655440000',
  signal_count: 2,
  market_signals_used: true,
  base_price: 100.5,
  minimum_recommended_price: 99.12,
  recommended_price: 104.34,
  maximum_recommended_price: 109.56,
  adjustments: { occupancy: 0.01, demand: 0.04, competitor: 0.02, seasonality: -0.01, local_event: 0.03, total: 0.09 },
};

describe('buildPricingPrompt', () => {
  it('includes the complete authoritative deterministic result without recalculating it', () => {
    const prompt = buildPricingPrompt(ruleBasedPricing);

    expect(prompt).toContain(ruleBasedPricing.property_id);
    expect(prompt).toContain('$100.50 USD');
    expect(prompt).toContain('$99.12 USD');
    expect(prompt).toContain('$104.34 USD');
    expect(prompt).toContain('$109.56 USD');
    expect(prompt).toContain('Signal count: 2');
    expect(prompt).toContain('Market signals used: true');
    for (const adjustment of ['Occupancy: 1.00%', 'Demand: 4.00%', 'Competitor: 2.00%', 'Seasonality: -1.00%', 'Local event: 3.00%', 'Total adjustment: 9.00%']) {
      expect(prompt).toContain(adjustment);
    }
    expect(prompt).toMatch(/authoritative/i);
  });

  it('requires exactly the shared fields and the unchanged deterministic price', () => {
    const prompt = buildPricingPrompt(ruleBasedPricing);

    expect(prompt).toMatch(/Return exactly these structured fields and no others/);
    expect(prompt).toMatch(/recommended_price/);
    expect(prompt).toMatch(/explanation/);
    expect(prompt).toMatch(/confidence_score/);
    expect(prompt).toMatch(/risk_level/);
    expect(prompt).toMatch(/exactly unchanged/i);
    expect(prompt).toMatch(/do not invent, calculate, widen, narrow, or override a pricing range/i);
  });
});
