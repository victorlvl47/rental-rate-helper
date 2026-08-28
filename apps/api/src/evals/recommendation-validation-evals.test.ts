import { describe, expect, it } from 'vitest';

import { calculateRuleBasedPricing } from '../pricing/rule-based-pricing.js';
import { validateAiPricingRecommendation } from '../ai/validate-ai-pricing-recommendation.js';
import {
  assertRecommendationValidationEvalCase,
  hasRecommendationValidationEvalContext,
  recommendationValidationEvalCases,
  type RecommendationValidationEvalCase,
} from './recommendation-validation-evals.js';

describe('recommendation validation eval dataset', () => {
  it('contains static, internally valid offline fixtures with known expected issue codes', () => {
    expect(recommendationValidationEvalCases.length).toBeGreaterThan(0);

    for (const evalCase of recommendationValidationEvalCases) {
      expect(() => assertRecommendationValidationEvalCase(evalCase)).not.toThrow();
    }
  });

  it('derives stable authoritative results from the existing deterministic engine', () => {
    for (const evalCase of recommendationValidationEvalCases) {
      if (!hasRecommendationValidationEvalContext(evalCase)) {
        expect(evalCase.expected.classification).toBe('missing_context');
        continue;
      }

      const first = calculateRuleBasedPricing(evalCase.property, evalCase.signals);
      const second = calculateRuleBasedPricing(evalCase.property, evalCase.signals);

      expect(second).toEqual(first);
    }
  });

  it('accepts valid cases based on their direction or bounded range, never explanation prose', () => {
    for (const evalCase of recommendationValidationEvalCases) {
      if (!hasRecommendationValidationEvalContext(evalCase) || evalCase.expected.kind !== 'accepted') {
        continue;
      }

      const authoritative = calculateRuleBasedPricing(evalCase.property, evalCase.signals);
      const validation = validateAiPricingRecommendation(evalCase.property, authoritative, evalCase.recommendation);

      expect(validation.valid, evalCase.id).toBe(true);
      if (!validation.valid) {
        continue;
      }
      expect(validation.recommendation.explanation.trim(), evalCase.id).not.toBe('');

      if (evalCase.expected.direction === 'maximum_price_cap') {
        expect(authoritative.recommended_price, evalCase.id).toBe(evalCase.property.max_price);
      } else if (evalCase.expected.direction === 'increase') {
        expect(authoritative.recommended_price, evalCase.id).toBeGreaterThan(evalCase.property.base_price);
      } else {
        expect(authoritative.recommended_price, evalCase.id).toBeLessThan(evalCase.property.base_price);
      }
    }
  });

  it('rejects invalid recommendations with only their safe expected classifications', () => {
    for (const evalCase of recommendationValidationEvalCases) {
      if (!hasRecommendationValidationEvalContext(evalCase) || evalCase.expected.kind !== 'rejected') {
        continue;
      }

      const authoritative = calculateRuleBasedPricing(evalCase.property, evalCase.signals);
      const validation = validateAiPricingRecommendation(evalCase.property, authoritative, evalCase.recommendation);

      expect(validation.valid, evalCase.id).toBe(false);
      if (!validation.valid) {
        expect(validation.issue_codes, evalCase.id).toEqual(evalCase.expected.issue_codes);
      }
    }
  });

  it('fails clearly for malformed definitions or unknown claimed validation codes', () => {
    const malformed: unknown = { id: 'no-context', expected: { kind: 'accepted', direction: 'increase' } };
    const unknownCode: unknown = {
      id: 'unknown-code',
      property: recommendationValidationEvalCases[0].property,
      signals: recommendationValidationEvalCases[0].signals,
      recommendation: undefined,
      expected: { kind: 'rejected', issue_codes: ['not-a-validation-code'] },
    };

    expect(() => assertRecommendationValidationEvalCase(malformed)).toThrow('must provide a valid property context');
    expect(() => assertRecommendationValidationEvalCase(unknownCode)).toThrow('claims unknown validation issue code');
  });
});
