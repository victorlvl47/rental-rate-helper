import { ActivityFailure, ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/pricing-recommendation-activity.js';
import { pricingWorkflowId, type PricingWorkflowRequest } from 'shared';

const activity = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 3, nonRetryableErrorTypes: ['INVALID_REQUEST','PROPERTY_NOT_FOUND','VALIDATION_REJECTED'] } });
export async function GeneratePricingRecommendationWorkflow(request: PricingWorkflowRequest): Promise<{ status: 'accepted'|'rejected'|'failed'|'already_existing'; issue_codes: string[] }> {
 const workflowId = pricingWorkflowId(request);
 let resolved;
 try { resolved = await activity.resolvePricingRequest(request, workflowId); } catch (error) { if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && error.cause.type === 'INVALID_REQUEST') return { status: 'failed', issue_codes: [] }; throw error; }
 if (resolved.existing && ['accepted','rejected'].includes(resolved.status)) return { status: 'already_existing', issue_codes: [] };
 await activity.markPricingStatus(request, 'running');
 try { const loaded = await activity.loadPricingData(request); const data = await activity.calculatePricing(loaded); const ai = await activity.callPricingAi(request, data.deterministic); const validation = await activity.validatePricingAi(data, ai.output); if (!validation.valid) { await activity.markPricingStatus(request, 'rejected', validation.issue_codes); await activity.recordPricingMetrics(request, ai.metrics); return { status: 'rejected', issue_codes: validation.issue_codes }; } const id = await activity.persistAcceptedPricing(request, data, validation.recommendation); await activity.recordPricingMetrics(request, ai.metrics, id); await activity.markPricingStatus(request, 'accepted'); return { status: 'accepted', issue_codes: [] }; } catch { await activity.markPricingStatus(request, 'failed'); return { status: 'failed', issue_codes: [] }; }
}
