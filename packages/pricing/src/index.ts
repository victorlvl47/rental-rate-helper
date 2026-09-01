import { aiPricingRecommendationSchema, recommendationValidationResultSchema, type AiPricingRecommendation, type MarketSignal, type Property, type RecommendationValidationIssueCode, type RecommendationValidationResult, type RuleBasedPricingResult } from 'shared';

export const PRICING_PROMPT_VERSION = 'v1';
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const average = (signals: readonly MarketSignal[], select: (signal: MarketSignal) => number) => signals.reduce((sum, signal) => sum + select(signal), 0) / signals.length;
export function calculateRuleBasedPricing(property: Property, signals: readonly MarketSignal[]): RuleBasedPricingResult {
  if (signals.some((signal) => signal.property_id !== property.id)) throw new Error('Every market signal must belong to the supplied property.');
  const occupancy = (property.target_occupancy_rate - property.current_occupancy_rate) * .2;
  const used = signals.length > 0;
  const demand = used ? (average(signals, s => s.demand_score) - .5) * .2 : 0;
  const competitor = used && property.base_price > 0 ? clamp((average(signals, s => s.competitor_avg_price) - property.base_price) / property.base_price, -.2, .2) * .5 : 0;
  const seasonality = used ? (average(signals, s => s.seasonality_score) - .5) * .1 : 0;
  const localEvent = used ? (average(signals, s => s.local_event_score) - .5) * .1 : 0;
  const total = clamp(occupancy + demand + competitor + seasonality + localEvent, -.35, .35);
  const raw = property.base_price * (1 + total);
  return { property_id: property.id, signal_count: signals.length, market_signals_used: used, base_price: property.base_price, minimum_recommended_price: cents(clamp(raw * .95, property.min_price, property.max_price)), recommended_price: cents(clamp(raw, property.min_price, property.max_price)), maximum_recommended_price: cents(clamp(raw * 1.05, property.min_price, property.max_price)), adjustments: { occupancy, demand, competitor, seasonality, local_event: localEvent, total } };
}
export interface AiPricingProvider { getRecommendation(result: RuleBasedPricingResult): Promise<AiPricingRecommendation>; getRecommendationWithMetrics?(result: RuleBasedPricingResult): Promise<{ recommendation: AiPricingRecommendation; metrics: import('shared').AiCallMetrics }>; }
export const stubAiPricingProvider: AiPricingProvider = { async getRecommendation(result) { return aiPricingRecommendationSchema.parse({ recommended_price: result.recommended_price, explanation: result.market_signals_used ? `The deterministic price uses ${result.signal_count} market signals.` : 'The deterministic price uses the occupancy-only fallback because no market signals are available.', confidence_score: result.market_signals_used ? .8 : .6, risk_level: result.market_signals_used ? 'low' : 'medium' }); }, async getRecommendationWithMetrics(result) { const recommendation = await this.getRecommendation(result); return { recommendation, metrics: { model: 'stub', prompt_version: PRICING_PROMPT_VERSION, input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: 0, success: true } }; } };
export function buildPricingPrompt(result: RuleBasedPricingResult): string { return `You provide explanation metadata for authoritative deterministic rental pricing. Return recommended_price exactly unchanged: ${result.recommended_price}. Range: ${result.minimum_recommended_price}-${result.maximum_recommended_price}.`; }
function add(issues: RecommendationValidationIssueCode[], issue: RecommendationValidationIssueCode) { if (!issues.includes(issue)) issues.push(issue); }
export function validateAiPricingRecommendation(property: Property, deterministic: RuleBasedPricingResult, output: unknown): RecommendationValidationResult {
  const parsed = aiPricingRecommendationSchema.safeParse(output);
  if (!parsed.success) { if (typeof output !== 'object' || output === null || Array.isArray(output)) return { valid: false, issue_codes: ['malformed_recommendation'] }; const issues: RecommendationValidationIssueCode[] = []; for (const issue of parsed.error.issues) { const field = issue.path[0]; if (field === 'explanation' && typeof (output as { explanation?: unknown }).explanation === 'string' && !(output as { explanation: string }).explanation.trim()) add(issues, 'blank_explanation'); else if (field === 'confidence_score' && 'confidence_score' in output) add(issues, 'invalid_confidence_score'); else if (field === 'risk_level' && 'risk_level' in output) add(issues, 'unsupported_risk_level'); else add(issues, 'malformed_recommendation'); } return { valid: false, issue_codes: issues.length ? issues : ['malformed_recommendation'] }; }
  const r = parsed.data, issues: RecommendationValidationIssueCode[] = [], rc = Math.round(r.recommended_price * 100), ac = Math.round(deterministic.recommended_price * 100), base = Math.round(property.base_price * 100);
  if (rc < Math.round(property.min_price*100) || rc > Math.round(property.max_price*100)) add(issues, 'price_outside_property_bounds');
  if (rc < Math.round(deterministic.minimum_recommended_price*100) || rc > Math.round(deterministic.maximum_recommended_price*100)) add(issues, 'price_outside_deterministic_range');
  if (rc !== ac) add(issues, 'price_mismatch_authoritative_result');
  if (ac * 100 > base * 130) add(issues, 'authoritative_result_exceeds_30_percent'); else if (rc * 100 > base * 130) add(issues, 'price_increase_exceeds_30_percent');
  return issues.length ? { valid: false, issue_codes: issues } : recommendationValidationResultSchema.parse({ valid: true, recommendation: r });
}
