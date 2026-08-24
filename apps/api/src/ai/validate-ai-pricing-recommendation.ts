import {
  aiPricingRecommendationSchema,
  recommendationValidationResultSchema,
  type Property,
  type RecommendationValidationIssueCode,
  type RecommendationValidationResult,
  type RuleBasedPricingResult,
} from 'shared';

const MAXIMUM_INCREASE_PERCENT = 30;

function toUsdCents(amount: number): number {
  return Math.round(amount * 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: RecommendationValidationIssueCode[],
  issue: RecommendationValidationIssueCode,
): void {
  if (!issues.includes(issue)) {
    issues.push(issue);
  }
}

function schemaIssueCodes(output: unknown): RecommendationValidationIssueCode[] {
  if (!isRecord(output)) {
    return ['malformed_recommendation'];
  }

  const parsed = aiPricingRecommendationSchema.safeParse(output);

  if (parsed.success) {
    return [];
  }

  const issues: RecommendationValidationIssueCode[] = [];

  for (const issue of parsed.error.issues) {
    const field = issue.path[0];

    if (field === 'explanation' && typeof output.explanation === 'string' && output.explanation.trim().length === 0) {
      addIssue(issues, 'blank_explanation');
    } else if (field === 'confidence_score' && 'confidence_score' in output) {
      addIssue(issues, 'invalid_confidence_score');
    } else if (field === 'risk_level' && 'risk_level' in output) {
      addIssue(issues, 'unsupported_risk_level');
    } else {
      addIssue(issues, 'malformed_recommendation');
    }
  }

  return issues.length > 0 ? issues : ['malformed_recommendation'];
}

/**
 * Validates unknown provider output against the existing structured-output
 * contract and the authoritative deterministic pricing result. This function
 * is pure and never adjusts either price.
 */
export function validateAiPricingRecommendation(
  property: Property,
  ruleBasedPricing: RuleBasedPricingResult,
  output: unknown,
): RecommendationValidationResult {
  const schemaIssues = schemaIssueCodes(output);

  if (schemaIssues.length > 0) {
    return recommendationValidationResultSchema.parse({
      valid: false,
      issue_codes: schemaIssues,
    });
  }

  const recommendation = aiPricingRecommendationSchema.parse(output);
  const recommendedPriceCents = toUsdCents(recommendation.recommended_price);
  const authoritativePriceCents = toUsdCents(ruleBasedPricing.recommended_price);
  const propertyMinimumCents = toUsdCents(property.min_price);
  const propertyMaximumCents = toUsdCents(property.max_price);
  const deterministicMinimumCents = toUsdCents(ruleBasedPricing.minimum_recommended_price);
  const deterministicMaximumCents = toUsdCents(ruleBasedPricing.maximum_recommended_price);
  const basePriceCents = toUsdCents(property.base_price);
  const issues: RecommendationValidationIssueCode[] = [];

  if (recommendedPriceCents < propertyMinimumCents || recommendedPriceCents > propertyMaximumCents) {
    addIssue(issues, 'price_outside_property_bounds');
  }

  if (recommendedPriceCents < deterministicMinimumCents || recommendedPriceCents > deterministicMaximumCents) {
    addIssue(issues, 'price_outside_deterministic_range');
  }

  if (recommendedPriceCents !== authoritativePriceCents) {
    addIssue(issues, 'price_mismatch_authoritative_result');
  }

  if (authoritativePriceCents * 100 > basePriceCents * (100 + MAXIMUM_INCREASE_PERCENT)) {
    addIssue(issues, 'authoritative_result_exceeds_30_percent');
  } else if (recommendedPriceCents * 100 > basePriceCents * (100 + MAXIMUM_INCREASE_PERCENT)) {
    addIssue(issues, 'price_increase_exceeds_30_percent');
  }

  if (issues.length > 0) {
    return recommendationValidationResultSchema.parse({
      valid: false,
      issue_codes: issues,
    });
  }

  return recommendationValidationResultSchema.parse({
    valid: true,
    recommendation,
  });
}
