import {
  marketSignalSchema,
  propertySchema,
  recommendationValidationIssueCodeSchema,
  type MarketSignal,
  type Property,
  type RecommendationValidationIssueCode,
} from 'shared';

export type PricingDirection = 'increase' | 'decrease' | 'lower_competitor_conservative' | 'maximum_price_cap';

type AcceptedExpectation = {
  readonly kind: 'accepted';
  readonly direction: PricingDirection;
};

type RejectedExpectation = {
  readonly kind: 'rejected';
  readonly issue_codes: readonly RecommendationValidationIssueCode[];
};

type MissingContextExpectation = {
  readonly kind: 'missing_context';
  readonly classification: 'missing_context';
};

export type EvaluableRecommendationValidationEvalCase = {
      readonly id: string;
      readonly property: Property;
      readonly signals: readonly MarketSignal[];
      readonly recommendation: unknown;
      readonly expected: AcceptedExpectation | RejectedExpectation;
    };

export type MissingContextRecommendationValidationEvalCase = {
      readonly id: string;
      readonly property?: undefined;
      readonly signals?: undefined;
      readonly recommendation: unknown;
      readonly expected: MissingContextExpectation;
    };

export type RecommendationValidationEvalCase =
  | EvaluableRecommendationValidationEvalCase
  | MissingContextRecommendationValidationEvalCase;

const validRecommendation = {
  recommended_price: 100,
  explanation: 'The price follows the deterministic market signal result.',
  confidence_score: 0.8,
  risk_level: 'low',
};

function property(id: string, overrides: Partial<Property> = {}): Property {
  return propertySchema.parse({
    id,
    name: 'Offline pricing eval property',
    city: 'New York',
    base_price: 100,
    min_price: 50,
    max_price: 200,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 2,
    current_occupancy_rate: 0.5,
    target_occupancy_rate: 0.5,
    ...overrides,
  });
}

function signal(propertyId: string, overrides: Partial<MarketSignal> = {}): MarketSignal {
  return marketSignalSchema.parse({
    property_id: propertyId,
    date: '2026-09-19',
    competitor_avg_price: 100,
    demand_score: 0.5,
    seasonality_score: 0.5,
    local_event_score: 0.5,
    ...overrides,
  });
}

const highDemandWeekend = property('10000000-0000-4000-8000-000000000001', {
  current_occupancy_rate: 0.3,
  target_occupancy_rate: 0.7,
});
const lowOccupancyWeekday = property('10000000-0000-4000-8000-000000000002', {
  base_price: 120,
  current_occupancy_rate: 0.9,
  target_occupancy_rate: 0.5,
});
const localEvent = property('10000000-0000-4000-8000-000000000003');
const lowerCompetitor = property('10000000-0000-4000-8000-000000000004');
const maximumCap = property('10000000-0000-4000-8000-000000000005', { max_price: 105 });
const neutral = property('10000000-0000-4000-8000-000000000006', { min_price: 80, max_price: 150 });
const nearThirtyPercent = property('10000000-0000-4000-8000-000000000007', {
  max_price: 150,
  current_occupancy_rate: 0,
  target_occupancy_rate: 0.5,
});
const aboveThirtyPercent = property('10000000-0000-4000-8000-000000000008', {
  max_price: 200,
  current_occupancy_rate: 0,
  target_occupancy_rate: 0.5,
});

/**
 * Static, offline inputs for validating recommendations. Tests derive every
 * authoritative result with calculateRuleBasedPricing; no fixture calculates
 * a second pricing result or calls a provider.
 */
export const recommendationValidationEvalCases: readonly RecommendationValidationEvalCase[] = [
  {
    id: 'high-demand-weekend-increase',
    property: highDemandWeekend,
    signals: [signal(highDemandWeekend.id, { competitor_avg_price: 120, demand_score: 0.95, seasonality_score: 0.75 })],
    recommendation: { ...validRecommendation, recommended_price: 129.5 },
    expected: { kind: 'accepted', direction: 'increase' },
  },
  {
    id: 'high-occupancy-low-demand-weekday-decrease',
    property: lowOccupancyWeekday,
    signals: [signal(lowOccupancyWeekday.id, { competitor_avg_price: 100, demand_score: 0.1, seasonality_score: 0.25 })],
    recommendation: { ...validRecommendation, recommended_price: 87.8 },
    expected: { kind: 'accepted', direction: 'decrease' },
  },
  {
    id: 'local-event-increase',
    property: localEvent,
    signals: [signal(localEvent.id, { local_event_score: 1 })],
    recommendation: { ...validRecommendation, recommended_price: 105 },
    expected: { kind: 'accepted', direction: 'increase' },
  },
  {
    id: 'lower-competitor-conservative-result',
    property: lowerCompetitor,
    signals: [signal(lowerCompetitor.id, { competitor_avg_price: 60 })],
    recommendation: { ...validRecommendation, recommended_price: 90 },
    expected: { kind: 'accepted', direction: 'lower_competitor_conservative' },
  },
  {
    id: 'property-maximum-price-cap',
    property: maximumCap,
    signals: [signal(maximumCap.id, { competitor_avg_price: 200, demand_score: 1, seasonality_score: 1, local_event_score: 1 })],
    recommendation: { ...validRecommendation, recommended_price: 105 },
    expected: { kind: 'accepted', direction: 'maximum_price_cap' },
  },
  {
    id: 'price-outside-property-bounds',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, recommended_price: 160 },
    expected: {
      kind: 'rejected',
      issue_codes: [
        'price_outside_property_bounds',
        'price_outside_deterministic_range',
        'price_mismatch_authoritative_result',
        'price_increase_exceeds_30_percent',
      ],
    },
  },
  {
    id: 'price-outside-deterministic-safe-range',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, recommended_price: 110 },
    expected: { kind: 'rejected', issue_codes: ['price_outside_deterministic_range', 'price_mismatch_authoritative_result'] },
  },
  {
    id: 'price-mismatch-authoritative-result',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, recommended_price: 101 },
    expected: { kind: 'rejected', issue_codes: ['price_mismatch_authoritative_result'] },
  },
  {
    id: 'ai-price-increase-above-thirty-percent',
    property: nearThirtyPercent,
    signals: [signal(nearThirtyPercent.id, { competitor_avg_price: 120, demand_score: 0.9 })],
    recommendation: { ...validRecommendation, recommended_price: 131 },
    expected: { kind: 'rejected', issue_codes: ['price_mismatch_authoritative_result', 'price_increase_exceeds_30_percent'] },
  },
  {
    id: 'authoritative-result-above-thirty-percent',
    property: aboveThirtyPercent,
    signals: [signal(aboveThirtyPercent.id, { competitor_avg_price: 200, demand_score: 1, seasonality_score: 1, local_event_score: 1 })],
    recommendation: { ...validRecommendation, recommended_price: 135 },
    expected: { kind: 'rejected', issue_codes: ['authoritative_result_exceeds_30_percent'] },
  },
  {
    id: 'confidence-outside-range',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, confidence_score: 1.01 },
    expected: { kind: 'rejected', issue_codes: ['invalid_confidence_score'] },
  },
  {
    id: 'unsupported-risk-level',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, risk_level: 'critical' },
    expected: { kind: 'rejected', issue_codes: ['unsupported_risk_level'] },
  },
  {
    id: 'blank-explanation',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, explanation: '   ' },
    expected: { kind: 'rejected', issue_codes: ['blank_explanation'] },
  },
  {
    id: 'malformed-structured-output',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: ['not', 'an', 'object'],
    expected: { kind: 'rejected', issue_codes: ['malformed_recommendation'] },
  },
  {
    id: 'extra-structured-output-field',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { ...validRecommendation, extra_field: true },
    expected: { kind: 'rejected', issue_codes: ['malformed_recommendation'] },
  },
  {
    id: 'missing-structured-output-field',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: { recommended_price: 100, explanation: 'A supplied explanation.', confidence_score: 0.8 },
    expected: { kind: 'rejected', issue_codes: ['malformed_recommendation'] },
  },
  {
    id: 'missing-recommendation-data',
    property: neutral,
    signals: [signal(neutral.id)],
    recommendation: undefined,
    expected: { kind: 'rejected', issue_codes: ['malformed_recommendation'] },
  },
  {
    id: 'missing-context-data',
    recommendation: undefined,
    expected: { kind: 'missing_context', classification: 'missing_context' },
  },
];

export function hasRecommendationValidationEvalContext(
  evalCase: RecommendationValidationEvalCase,
): evalCase is EvaluableRecommendationValidationEvalCase {
  return evalCase.expected.kind !== 'missing_context';
}

/** Throws a clear error when a checked-in or in-memory eval definition is unsafe to evaluate. */
export function assertRecommendationValidationEvalCase(value: unknown): asserts value is RecommendationValidationEvalCase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Eval case must be an object.');
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
    throw new Error('Eval case must have a non-blank id.');
  }

  if (typeof candidate.expected !== 'object' || candidate.expected === null || Array.isArray(candidate.expected)) {
    throw new Error(`Eval case "${candidate.id}" must have an expected outcome.`);
  }

  const expected = candidate.expected as Record<string, unknown>;

  if (expected.kind === 'missing_context') {
    if (candidate.property !== undefined || candidate.signals !== undefined || expected.classification !== 'missing_context') {
      throw new Error(`Eval case "${candidate.id}" has an invalid missing-context definition.`);
    }
    return;
  }

  if (expected.kind !== 'accepted' && expected.kind !== 'rejected') {
    throw new Error(`Eval case "${candidate.id}" has an unknown expected outcome kind.`);
  }

  if (!propertySchema.safeParse(candidate.property).success) {
    throw new Error(`Eval case "${candidate.id}" must provide a valid property context.`);
  }

  if (!Array.isArray(candidate.signals) || candidate.signals.some((entry) => !marketSignalSchema.safeParse(entry).success)) {
    throw new Error(`Eval case "${candidate.id}" must provide valid market-signal context.`);
  }

  if (expected.kind === 'accepted') {
    if (!['increase', 'decrease', 'lower_competitor_conservative', 'maximum_price_cap'].includes(expected.direction as string)) {
      throw new Error(`Eval case "${candidate.id}" has an unknown pricing direction.`);
    }
    return;
  }

  if (!Array.isArray(expected.issue_codes) || expected.issue_codes.length === 0) {
    throw new Error(`Eval case "${candidate.id}" must claim at least one validation issue code.`);
  }

  for (const code of expected.issue_codes) {
    if (!recommendationValidationIssueCodeSchema.safeParse(code).success) {
      throw new Error(`Eval case "${candidate.id}" claims unknown validation issue code "${String(code)}".`);
    }
  }
}
