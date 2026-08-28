import { describe, expect, it, vi } from 'vitest';

import { validateAiPricingRecommendation } from '../ai/validate-ai-pricing-recommendation.js';
import { calculateRuleBasedPricing } from '../pricing/rule-based-pricing.js';
import { runRecommendationValidationEvalCli } from './recommendation-validation-eval-cli.js';
import {
  runRecommendationValidationEvals,
  type RecommendationValidationEvalRunnerDependencies,
} from './recommendation-validation-eval-runner.js';
import {
  hasRecommendationValidationEvalContext,
  recommendationValidationEvalCases,
  type EvaluableRecommendationValidationEvalCase,
} from './recommendation-validation-evals.js';

function dependencies(): RecommendationValidationEvalRunnerDependencies {
  return {
    calculateRuleBasedPricing: vi.fn(calculateRuleBasedPricing),
    validateAiPricingRecommendation: vi.fn(validateAiPricingRecommendation),
  };
}

function mismatchedCase(id: string): EvaluableRecommendationValidationEvalCase {
  const source = recommendationValidationEvalCases[0];

  if (!hasRecommendationValidationEvalContext(source)) {
    throw new Error('The first checked-in eval case must provide pricing context.');
  }

  return {
    ...source,
    id,
    expected: { kind: 'rejected', issue_codes: ['price_mismatch_authoritative_result'] as const },
  };
}

describe('recommendation validation eval runner', () => {
  it('evaluates every checked-in case through the deterministic engine and validator', () => {
    const runnerDependencies = dependencies();
    const result = runRecommendationValidationEvals(recommendationValidationEvalCases, runnerDependencies);
    const casesWithContext = recommendationValidationEvalCases.filter((evalCase) => evalCase.expected.kind !== 'missing_context');

    expect(result).toMatchObject({
      passed: true,
      passed_count: recommendationValidationEvalCases.length,
      failed_count: 0,
      total_count: recommendationValidationEvalCases.length,
    });
    expect(result.cases.map((entry) => entry.case_id)).toEqual(recommendationValidationEvalCases.map((entry) => entry.id));
    expect(runnerDependencies.calculateRuleBasedPricing).toHaveBeenCalledTimes(casesWithContext.length);
    expect(runnerDependencies.validateAiPricingRecommendation).toHaveBeenCalledTimes(casesWithContext.length);
  });

  it('returns a deterministic expected-versus-actual failure for an in-memory mismatch', () => {
    const mismatched = mismatchedCase('deliberately-mismatched-case');

    expect(runRecommendationValidationEvals([mismatched])).toEqual({
      cases: [{
        case_id: 'deliberately-mismatched-case',
        passed: false,
        expected_classification: { kind: 'rejected', issue_codes: ['price_mismatch_authoritative_result'] },
        actual_classification: { kind: 'accepted' },
      }],
      passed_count: 0,
      failed_count: 1,
      total_count: 1,
      passed: false,
    });
  });

  it('prints deterministic safe output and returns a non-zero exit code for failures', () => {
    const mismatched = mismatchedCase('cli-mismatched-case');
    const lines: string[] = [];
    const setExitCode = vi.fn();

    const result = runRecommendationValidationEvalCli({
      evalCases: [mismatched],
      writeLine: (line) => lines.push(line),
      setExitCode,
    });

    expect(result.passed).toBe(false);
    expect(lines).toEqual([
      'cli-mismatched-case FAIL expected=price_mismatch_authoritative_result actual=accepted',
      'Summary: 0 passed, 1 failed, 1 total',
    ]);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
