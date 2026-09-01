import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/pricing-recommendation-activity.js';
import type { PricingWorkflowRequest } from 'shared';

const activity = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 3, nonRetryableErrorTypes: ['INVALID_REQUEST','PROPERTY_NOT_FOUND','VALIDATION_REJECTED'] } });
export async function GeneratePricingRecommendationWorkflow(request: PricingWorkflowRequest): Promise<{ status: 'accepted'|'rejected'|'failed'|'already_existing'; issue_codes: string[] }> {
 const workflowId = `pricing-${request.property_id}-${request.pricing_date}`;
 const resolved = await activity.resolvePricingRequest(request, workflowId);
 if (resolved.existing && ['accepted','rejected'].includes(resolved.status)) return { status: 'already_existing', issue_codes: [] };
 await activity.markPricingStatus(request, 'running');
 try { const loaded = await activity.loadPricingData(request); const data = await activity.calculatePricing(loaded); const ai = await activity.callPricingAi(data.deterministic); const validation = await activity.validatePricingAi(data, ai.output); if (!validation.valid) { await activity.markPricingStatus(request, 'rejected', validation.issue_codes); await activity.recordPricingMetrics(request, { ...ai.metrics, success: false }); return { status: 'rejected', issue_codes: validation.issue_codes }; } const id = await activity.persistAcceptedPricing(request, data, validation.recommendation); await activity.recordPricingMetrics(request, ai.metrics, id); await activity.markPricingStatus(request, 'accepted'); return { status: 'accepted', issue_codes: [] }; } catch { await activity.markPricingStatus(request, 'failed'); return { status: 'failed', issue_codes: [] }; }
}
