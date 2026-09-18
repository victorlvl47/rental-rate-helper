import { ApplicationFailure } from '@temporalio/workflow';
import { describe, expect, it } from 'vitest';
import { callPricingAi, loadPricingData, setPricingActivityDependencies } from './pricing-recommendation-activity.js';
import type { PricingWorkflowRequest, RuleBasedPricingResult } from 'shared';

const request: PricingWorkflowRequest = { property_id: '10000000-0000-4000-8000-000000000001', pricing_date: '2026-09-14' };
const deterministic: RuleBasedPricingResult = { property_id: request.property_id, signal_count: 0, market_signals_used: false, base_price: 100, minimum_recommended_price: 95, recommended_price: 100, maximum_recommended_price: 105, adjustments: { occupancy: 0, demand: 0, competitor: 0, seasonality: 0, local_event: 0, total: 0 } };
const repository = { createOrResolve: async () => ({ id: 'id', workflow_id: 'workflow', status: 'pending' as const, existing: false }), updateStatus: async () => undefined, saveAccepted: async () => 'id', saveMetrics: async () => undefined, getStatus: async () => undefined };

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
