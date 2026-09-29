import { ApplicationFailure } from '@temporalio/workflow';
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredAiPricingProvider } from 'pricing';
import { callPricingAi, loadPricingData, setPricingActivityDependencies } from './pricing-recommendation-activity.js';
import type { PricingWorkflowRequest, RuleBasedPricingResult } from 'shared';

const request: PricingWorkflowRequest = { property_id: '10000000-0000-4000-8000-000000000001', pricing_date: '2026-09-14' };
const deterministic: RuleBasedPricingResult = { property_id: request.property_id, signal_count: 0, market_signals_used: false, base_price: 100, minimum_recommended_price: 95, recommended_price: 100, maximum_recommended_price: 105, adjustments: { occupancy: 0, demand: 0, competitor: 0, seasonality: 0, local_event: 0, total: 0 } };
const repository = { createOrResolve: async () => ({ id: 'id', workflow_id: 'workflow', status: 'pending' as const, existing: false }), updateStatus: async () => undefined, saveAccepted: async () => 'id', saveMetrics: async () => undefined, getStatus: async () => undefined, listAcceptedRecommendations: async () => [], getDashboardSummary: async () => ({ total_workflow_requests: 0, accepted_recommendations: 0, failed_workflows: 0, validation_rejections: 0, validation_pass_rate: null, average_ai_latency_ms: null, estimated_ai_cost_usd: null, recent_failed_workflows: [] }) };

describe('pricing activities', () => {
  it('uses stub output with truthful null usage metrics', async () => {
    setPricingActivityDependencies({ repository, provider: { getRecommendation: async () => ({ recommended_price: 100, explanation: 'stub', confidence_score: 0.8, risk_level: 'low' }) } });
    const result = await callPricingAi(request, deterministic);
    expect(result.metrics).toMatchObject({ success: true, input_tokens: null, output_tokens: null, estimated_cost_usd: null });
  });
  it('classifies missing properties as terminal and provider errors as retryable', async () => {
    setPricingActivityDependencies({ repository, rentalDataRepository: { findPropertyById: async () => undefined, listMarketSignals: async () => [] }, provider: { getRecommendation: async () => { throw new Error('transport secret'); } } });
    await expect(loadPricingData(request)).rejects.toMatchObject({ type: 'PROPERTY_NOT_FOUND', nonRetryable: true });
    await expect(callPricingAi(request, deterministic)).rejects.toMatchObject({ type: 'PROVIDER_FAILURE', nonRetryable: false });
  });
});

  it('persists a known failed-provider cost for dashboard totals', async () => {
    const saveMetrics = vi.fn(async () => undefined);
    const provider = createConfiguredAiPricingProvider({ environment: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, fetch: async () => ({ ok: true, json: async () => ({ usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 }, output: [] }) }) });
    setPricingActivityDependencies({ repository: { ...repository, saveMetrics }, provider });
    await expect(callPricingAi(request, deterministic)).rejects.toMatchObject({ type: 'PROVIDER_FAILURE' });
    expect(saveMetrics).toHaveBeenCalledWith(request, expect.objectContaining({ model: 'gpt-4o-mini', input_tokens: 1_000_000, output_tokens: 1_000_000, estimated_cost_usd: 0.75, success: false }));
  });
