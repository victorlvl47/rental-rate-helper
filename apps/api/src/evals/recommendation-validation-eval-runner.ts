import type {
  RecommendationValidationIssueCode,
  RecommendationValidationResult,
  RuleBasedPricingResult,
} from 'shared';

import { validateAiPricingRecommendation } from '../ai/validate-ai-pricing-recommendation.js';
import { calculateRuleBasedPricing } from '../pricing/rule-based-pricing.js';
import {
  assertRecommendationValidationEvalCase,
  hasRecommendationValidationEvalContext,
  recommendationValidationEvalCases,
  type RecommendationValidationEvalCase,
} from './recommendation-validation-evals.js';

export type RecommendationValidationEvalClassification =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'missing_context' }
  | { readonly kind: 'rejected'; readonly issue_codes: readonly RecommendationValidationIssueCode[] };

export type RecommendationValidationEvalCaseResult = {
  readonly case_id: string;
  readonly passed: boolean;
  readonly expected_classification: RecommendationValidationEvalClassification;
  readonly actual_classification: RecommendationValidationEvalClassification;
};

export type RecommendationValidationEvalAggregateResult = {
  readonly cases: readonly RecommendationValidationEvalCaseResult[];
  readonly passed_count: number;
  readonly failed_count: number;
  readonly total_count: number;
  readonly passed: boolean;
};

export type RecommendationValidationEvalRunnerDependencies = {
  readonly calculateRuleBasedPricing: typeof calculateRuleBasedPricing;
  readonly validateAiPricingRecommendation: typeof validateAiPricingRecommendation;
};

const defaultDependencies: RecommendationValidationEvalRunnerDependencies = {
  calculateRuleBasedPricing,
  validateAiPricingRecommendation,
};

function issueCodeClassification(
  issueCodes: readonly RecommendationValidationIssueCode[],
): RecommendationValidationEvalClassification {
  return { kind: 'rejected', issue_codes: issueCodes };
}

function expectedClassification(evalCase: RecommendationValidationEvalCase): RecommendationValidationEvalClassification {
  if (evalCase.expected.kind === 'accepted') {
    return { kind: 'accepted' };
  }

  if (evalCase.expected.kind === 'missing_context') {
    return { kind: 'missing_context' };
  }

  return issueCodeClassification(evalCase.expected.issue_codes);
}

function actualClassification(validation: RecommendationValidationResult): RecommendationValidationEvalClassification {
  return validation.valid ? { kind: 'accepted' } : issueCodeClassification(validation.issue_codes);
}

function classificationsMatch(
  expected: RecommendationValidationEvalClassification,
  actual: RecommendationValidationEvalClassification,
): boolean {
  if (expected.kind !== actual.kind) {
    return false;
  }

  if (expected.kind !== 'rejected' || actual.kind !== 'rejected') {
    return true;
  }

  return expected.issue_codes.length === actual.issue_codes.length &&
    expected.issue_codes.every((issueCode, index) => issueCode === actual.issue_codes[index]);
}

function formatClassification(classification: RecommendationValidationEvalClassification): string {
  return classification.kind === 'rejected' ? classification.issue_codes.join(',') : classification.kind;
}

/**
 * Evaluates the checked-in recommendation fixtures using only the established
 * deterministic pricing engine and business validator. It performs no I/O.
 */
export function runRecommendationValidationEvals(
  evalCases: readonly RecommendationValidationEvalCase[] = recommendationValidationEvalCases,
  dependencies: RecommendationValidationEvalRunnerDependencies = defaultDependencies,
): RecommendationValidationEvalAggregateResult {
  const cases = evalCases.map((evalCase) => {
    assertRecommendationValidationEvalCase(evalCase);

    const expected = expectedClassification(evalCase);
    const actual: RecommendationValidationEvalClassification = hasRecommendationValidationEvalContext(evalCase)
      ? actualClassification(
          dependencies.validateAiPricingRecommendation(
            evalCase.property,
            dependencies.calculateRuleBasedPricing(evalCase.property, evalCase.signals),
            evalCase.recommendation,
          ),
        )
      : { kind: 'missing_context' };

    return {
      case_id: evalCase.id,
      passed: classificationsMatch(expected, actual),
      expected_classification: expected,
      actual_classification: actual,
    };
  });
  const passedCount = cases.filter((result) => result.passed).length;

  return {
    cases,
    passed_count: passedCount,
    failed_count: cases.length - passedCount,
    total_count: cases.length,
    passed: passedCount === cases.length,
  };
}

export function formatRecommendationValidationEvalCaseResult(result: RecommendationValidationEvalCaseResult): string {
  return `${result.case_id} ${result.passed ? 'PASS' : 'FAIL'} expected=${formatClassification(result.expected_classification)} actual=${formatClassification(result.actual_classification)}`;
}

export function formatRecommendationValidationEvalSummary(result: RecommendationValidationEvalAggregateResult): string {
  return `Summary: ${result.passed_count} passed, ${result.failed_count} failed, ${result.total_count} total`;
}
