import { estimateOpenAiCostUsd, OPENAI_PRICING_TABLE_VERSION } from './model-pricing.js';
import { aiPricingRecommendationSchema, recommendationValidationResultSchema, type AiPricingRecommendation, type MarketSignal, type Property, type RecommendationValidationIssueCode, type RecommendationValidationResult, type RuleBasedPricingResult } from 'shared';

export const PRICING_PROMPT_VERSION = 'v1';
const MAX_PRICE_INCREASE_PERCENT = 30;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const average = (signals: readonly MarketSignal[], select: (signal: MarketSignal) => number) => signals.reduce((sum, signal) => sum + select(signal), 0) / signals.length;

export class InvalidPricingConfigurationError extends Error {
  constructor() {
    super('Property minimum price exceeds the maximum allowed price increase.');
    this.name = 'InvalidPricingConfigurationError';
  }
}

function minimumExceedsMaximumIncrease(property: Property): boolean {
  const minimumCents = Math.round(property.min_price * 100);
  const baseCents = Math.round(property.base_price * 100);
  return minimumCents * 100 > baseCents * (100 + MAX_PRICE_INCREASE_PERCENT);
}

export function calculateRuleBasedPricing(property: Property, signals: readonly MarketSignal[]): RuleBasedPricingResult {
  if (signals.some((signal) => signal.property_id !== property.id)) throw new Error('Every market signal must belong to the supplied property.');
  if (minimumExceedsMaximumIncrease(property)) throw new InvalidPricingConfigurationError();
  const occupancy = (property.target_occupancy_rate - property.current_occupancy_rate) * .2;
  const used = signals.length > 0;
  const demand = used ? (average(signals, s => s.demand_score) - .5) * .2 : 0;
  const competitor = used && property.base_price > 0 ? clamp((average(signals, s => s.competitor_avg_price) - property.base_price) / property.base_price, -.2, .2) * .5 : 0;
  const seasonality = used ? (average(signals, s => s.seasonality_score) - .5) * .1 : 0;
  const localEvent = used ? (average(signals, s => s.local_event_score) - .5) * .1 : 0;
  // The deterministic engine must never create a price that validation would
  // reject for exceeding the documented 30% increase limit.
  const total = clamp(occupancy + demand + competitor + seasonality + localEvent, -.35, MAX_PRICE_INCREASE_PERCENT / 100);
  const raw = property.base_price * (1 + total);
  return { property_id: property.id, signal_count: signals.length, market_signals_used: used, base_price: property.base_price, minimum_recommended_price: cents(clamp(raw * .95, property.min_price, property.max_price)), recommended_price: cents(clamp(raw, property.min_price, property.max_price)), maximum_recommended_price: cents(clamp(raw * 1.05, property.min_price, property.max_price)), adjustments: { occupancy, demand, competitor, seasonality, local_event: localEvent, total } };
}
export interface AiPricingProvider { getRecommendation(result: RuleBasedPricingResult): Promise<AiPricingRecommendation>; getRecommendationWithMetrics?(result: RuleBasedPricingResult): Promise<{ recommendation: AiPricingRecommendation; metrics: import('shared').AiCallMetrics }>; }
export const stubAiPricingProvider: AiPricingProvider = { async getRecommendation(result) { return aiPricingRecommendationSchema.parse({ recommended_price: result.recommended_price, explanation: result.market_signals_used ? `The deterministic price uses ${result.signal_count} market signals.` : 'The deterministic price uses the occupancy-only fallback because no market signals are available.', confidence_score: result.market_signals_used ? .8 : .6, risk_level: result.market_signals_used ? 'low' : 'medium' }); }, async getRecommendationWithMetrics(result) { const recommendation = await this.getRecommendation(result); return { recommendation, metrics: { model: 'stub', prompt_version: PRICING_PROMPT_VERSION, input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: 0, success: true } }; } };

export type AiProviderEnvironment = Readonly<Record<string, string | undefined>>;
export type FetchLike = (input: string, init?: unknown) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
export interface ConfiguredAiPricingProviderOptions { environment?: AiProviderEnvironment; fetch?: FetchLike; }

/** Shared provider selection for both API and worker. No provider call occurs during selection. */
export function createConfiguredAiPricingProvider(options: ConfiguredAiPricingProviderOptions = {}): AiPricingProvider {
  const environment = options.environment ?? (globalThis as { process?: { env: AiProviderEnvironment } }).process?.env ?? {};
  if (environment.AI_PROVIDER === undefined || environment.AI_PROVIDER === 'stub') return stubAiPricingProvider;
  if (environment.AI_PROVIDER !== 'openai') throw new Error('AI_PROVIDER must be either "stub" or "openai".');
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY must be configured when AI_PROVIDER is "openai".');
  const model = environment.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const fetch = options.fetch ?? ((globalThis as { fetch?: FetchLike }).fetch?.bind(globalThis));
  if (!fetch) throw new Error('Fetch is unavailable for the OpenAI provider.');
  return createOpenAiProvider({ apiKey, model, fetch });
}
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

interface OpenAiProviderOptions { apiKey: string; model: string; fetch: FetchLike; }
type OpenAiPayload = { status?: unknown; output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }>; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
class OpenAiProviderFailure extends Error { constructor(readonly metrics: import('shared').AiCallMetrics) { super('OpenAI pricing provider failed.'); } }
function usageMetrics(payload: OpenAiPayload | undefined, model: string, latency_ms: number, success: boolean): import('shared').AiCallMetrics { const input = typeof payload?.usage?.input_tokens === 'number' && Number.isInteger(payload.usage.input_tokens) && payload.usage.input_tokens >= 0 ? payload.usage.input_tokens : null; const output = typeof payload?.usage?.output_tokens === 'number' && Number.isInteger(payload.usage.output_tokens) && payload.usage.output_tokens >= 0 ? payload.usage.output_tokens : null; return { model, prompt_version: PRICING_PROMPT_VERSION, input_tokens: input, output_tokens: output, estimated_cost_usd: estimateOpenAiCostUsd(model, input, output), latency_ms, success }; }
function createOpenAiProvider(options: OpenAiProviderOptions): AiPricingProvider { return { async getRecommendation(result) { return (await this.getRecommendationWithMetrics!(result)).recommendation; }, async getRecommendationWithMetrics(result) { const started = Date.now(); let payload: OpenAiPayload | undefined; try { const response = await options.fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: options.model, store: false, input: [{ role: 'user', content: [{ type: 'input_text', text: buildPricingPrompt(result) }] }], text: { format: { type: 'json_schema', name: 'ai_pricing_recommendation', strict: true, schema: { type: 'object', additionalProperties: false, required: ['recommended_price', 'explanation', 'confidence_score', 'risk_level'], properties: { recommended_price: { type: 'number', enum: [result.recommended_price] }, explanation: { type: 'string', minLength: 1 }, confidence_score: { type: 'number', minimum: 0, maximum: 1 }, risk_level: { type: 'string', enum: ['low', 'medium', 'high'] } } } } } }) }); if (!response.ok) throw new Error('HTTP_ERROR'); payload = await response.json() as OpenAiPayload; const text = payload.output?.flatMap((item) => item.type === 'message' ? item.content ?? [] : []).find((content) => content.type === 'output_text')?.text; if (typeof text !== 'string') throw new Error('INVALID_OUTPUT'); const recommendation = aiPricingRecommendationSchema.parse(JSON.parse(text)); if (recommendation.recommended_price !== result.recommended_price) throw new Error('INVALID_OUTPUT'); return { recommendation, metrics: usageMetrics(payload, options.model, Date.now() - started, true) }; } catch { throw new OpenAiProviderFailure(usageMetrics(payload, options.model, Date.now() - started, false)); } } }; }
export function getProviderFailureMetrics(error: unknown): import('shared').AiCallMetrics | undefined { return error instanceof OpenAiProviderFailure ? error.metrics : undefined; }
