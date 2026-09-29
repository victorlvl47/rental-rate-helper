import { ApplicationFailure } from '@temporalio/workflow';
import { asc, eq } from 'drizzle-orm';
import { createRecommendationWorkflowRepository, db, marketSignals, properties, type RecommendationWorkflowRepository } from 'database';
import { calculateRuleBasedPricing, createConfiguredAiPricingProvider, getProviderFailureMetrics, InvalidPricingConfigurationError, PRICING_PROMPT_VERSION, type AiPricingProvider, validateAiPricingRecommendation } from 'pricing';
import type { AiCallMetrics, PricingWorkflowData, PricingWorkflowRequest, PricingWorkflowStatus } from 'shared';
import { marketSignalSchema, pricingWorkflowId, pricingWorkflowRequestSchema, propertySchema, type MarketSignal, type Property } from 'shared';
import { captureUnexpected } from '../observability/sentry.js';

export type PricingFailureType = 'INVALID_REQUEST' | 'INVALID_PRICING_CONFIGURATION' | 'PROPERTY_NOT_FOUND' | 'VALIDATION_REJECTED' | 'PROVIDER_FAILURE' | 'PERSISTENCE_FAILURE';
const terminalFailure = (message: string, type: PricingFailureType) => ApplicationFailure.nonRetryable(message, type);
const transientFailure = (message: string, type: PricingFailureType) => ApplicationFailure.retryable(message, type);

export interface RentalDataRepository { findPropertyById(id: string): Promise<Property | undefined>; listMarketSignals(id: string): Promise<MarketSignal[]>; }
const asNumber = (value: string | number) => typeof value === 'number' ? value : Number(value);
const rentalDataRepository: RentalDataRepository = {
  async findPropertyById(id) { const [row] = await db.select().from(properties).where(eq(properties.id, id)).limit(1); return row ? propertySchema.parse({ ...row, base_price: asNumber(row.base_price), min_price: asNumber(row.min_price), max_price: asNumber(row.max_price), bathrooms: asNumber(row.bathrooms), current_occupancy_rate: asNumber(row.current_occupancy_rate), target_occupancy_rate: asNumber(row.target_occupancy_rate) }) : undefined; },
  async listMarketSignals(id) { const rows = await db.select().from(marketSignals).where(eq(marketSignals.property_id, id)).orderBy(asc(marketSignals.date)); return rows.map((row) => marketSignalSchema.parse({ ...row, competitor_avg_price: asNumber(row.competitor_avg_price), local_event_score: asNumber(row.local_event_score), seasonality_score: asNumber(row.seasonality_score), demand_score: asNumber(row.demand_score) })); },
};
export interface PricingActivityDependencies { rentalDataRepository: RentalDataRepository; repository: RecommendationWorkflowRepository; provider: AiPricingProvider; }
let dependencies: PricingActivityDependencies = { rentalDataRepository, repository: createRecommendationWorkflowRepository(), provider: createConfiguredAiPricingProvider() };
export function setPricingActivityDependencies(next: Partial<PricingActivityDependencies>): void { dependencies = { ...dependencies, ...next }; }

type SafeLogFields = Record<string, string | number | boolean>;
type SafeCorrelation = Record<'workflow_id' | 'property_id' | 'pricing_date', string>;
function correlation(request: PricingWorkflowRequest, workflowId = pricingWorkflowId(request)): SafeCorrelation { return { workflow_id: workflowId, property_id: request.property_id, pricing_date: request.pricing_date }; }
function logEvent(level: 'error' | 'info', event: string, extra: SafeLogFields = {}): void { console[level](JSON.stringify({ level, service: 'worker', component: 'pricing_activity', event, ...extra })); }
function reportFailure(event: string, failure_type: string, request?: PricingWorkflowRequest): void { const fields = { ...(request ? correlation(request) : {}), failure_type }; logEvent('error', event, fields); captureUnexpected(undefined, { service: 'worker', component: 'pricing_activity', event, failure_type, ...(request ? correlation(request) : {}) }); }

export async function recordWorkflowStarted(request: PricingWorkflowRequest, workflowId: string): Promise<void> { logEvent('info', 'workflow_started', correlation(request, workflowId)); }
export async function recordWorkflowCompleted(request: PricingWorkflowRequest, status: 'accepted' | 'rejected' | 'failed'): Promise<void> { logEvent('info', 'workflow_completed', { ...correlation(request), status }); }
export async function resolvePricingRequest(request: PricingWorkflowRequest, workflowId: string) { const parsed = pricingWorkflowRequestSchema.safeParse(request); if (!parsed.success) throw terminalFailure('Pricing request is invalid.', 'INVALID_REQUEST'); try { return await dependencies.repository.createOrResolve(parsed.data, workflowId); } catch { reportFailure('request_persistence_failed', 'database', request); throw transientFailure('Pricing request persistence failed.', 'PERSISTENCE_FAILURE'); } }
export async function markPricingStatus(request: PricingWorkflowRequest, status: PricingWorkflowStatus, issueCodes: string[] = [], failureCode?: string) { try { await dependencies.repository.updateStatus(request, status, issueCodes, failureCode); } catch { reportFailure('status_persistence_failed', 'database', request); throw transientFailure('Pricing request persistence failed.', 'PERSISTENCE_FAILURE'); } }
export async function loadPricingData(request: PricingWorkflowRequest): Promise<Omit<PricingWorkflowData, 'deterministic'>> { try { const property = await dependencies.rentalDataRepository.findPropertyById(request.property_id); if (!property) throw terminalFailure('Property not found.', 'PROPERTY_NOT_FOUND'); return { property, signals: await dependencies.rentalDataRepository.listMarketSignals(request.property_id) }; } catch (error) { if (error instanceof ApplicationFailure) throw error; reportFailure('pricing_data_load_failed', 'database', request); throw transientFailure('Pricing data load failed.', 'PERSISTENCE_FAILURE'); } }
export async function calculatePricing(data: Omit<PricingWorkflowData, 'deterministic'>): Promise<PricingWorkflowData> { try { return { ...data, deterministic: calculateRuleBasedPricing(data.property, data.signals) }; } catch (error) { if (error instanceof InvalidPricingConfigurationError) throw terminalFailure('Pricing configuration is invalid.', 'INVALID_PRICING_CONFIGURATION'); throw terminalFailure('Pricing request is invalid.', 'INVALID_REQUEST'); } }
export async function callPricingAi(request: PricingWorkflowRequest, deterministic: PricingWorkflowData['deterministic']): Promise<{ output: unknown; metrics: AiCallMetrics }> {
  const started = Date.now();
  logEvent('info', 'ai_request_started', correlation(request));
  try {
    if (dependencies.provider.getRecommendationWithMetrics) {
      const result = await dependencies.provider.getRecommendationWithMetrics(deterministic);
      logEvent('info', 'ai_request_completed', correlation(request));
      return { output: result.recommendation, metrics: result.metrics };
    }
    const output = await dependencies.provider.getRecommendation(deterministic);
    const metrics = { model: 'unknown', prompt_version: PRICING_PROMPT_VERSION, input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: Date.now() - started, success: true };
    logEvent('info', 'ai_request_completed', correlation(request));
    return { output, metrics };
  } catch (error) {
    const metrics = getProviderFailureMetrics(error) ?? { model: 'unknown', prompt_version: PRICING_PROMPT_VERSION, input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: Date.now() - started, success: false };
    try { await dependencies.repository.saveMetrics(request, metrics); } catch { reportFailure('failed_provider_metrics_persistence_failed', 'metrics_persistence', request); }
    reportFailure('ai_provider_failed', 'provider', request);
    throw transientFailure('AI provider failed.', 'PROVIDER_FAILURE');
  }
}
export async function validatePricingAi(request: PricingWorkflowRequest, data: PricingWorkflowData, output: unknown) { const validation = validateAiPricingRecommendation(data.property, data.deterministic, output); const fields = correlation(request); if (!validation.valid) logEvent('info', 'validation_rejected', { ...fields, issue_count: validation.issue_codes.length }); else logEvent('info', 'validation_passed', fields); return validation; }
export async function persistAcceptedPricing(request: PricingWorkflowRequest, data: PricingWorkflowData, metadata: Parameters<RecommendationWorkflowRepository['saveAccepted']>[2]) { try { const recommendationId = await dependencies.repository.saveAccepted(request, data.deterministic, metadata); logEvent('info', 'recommendation_generated', correlation(request)); return recommendationId; } catch { reportFailure('recommendation_persistence_failed', 'database', request); throw transientFailure('Recommendation persistence failed.', 'PERSISTENCE_FAILURE'); } }
export async function recordPricingMetrics(request: PricingWorkflowRequest, metrics: AiCallMetrics, recommendationId?: string) { try { await dependencies.repository.saveMetrics(request, metrics, recommendationId); } catch { reportFailure('metrics_persistence_failed', 'metrics_persistence', request); throw transientFailure('Metrics persistence failed.', 'PERSISTENCE_FAILURE'); } }
export async function recordTerminalWorkflowFailure(request: PricingWorkflowRequest, failureCode = 'WORKFLOW_FAILURE') { logEvent('error', 'terminal_workflow_failed', { ...correlation(request), failure_code: failureCode }); captureUnexpected(undefined, { service: 'worker', component: 'pricing_activity', event: 'terminal_workflow_failed', failure_type: failureCode, ...correlation(request) }); await markPricingStatus(request, 'failed', [], failureCode); }
