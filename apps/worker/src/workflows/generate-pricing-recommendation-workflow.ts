import { ActivityFailure, ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/pricing-recommendation-activity.js';
import { pricingWorkflowId, type PricingWorkflowRequest } from 'shared';

const activity = proxyActivities<typeof activities>({ startToCloseTimeout: '1 minute', retry: { maximumAttempts: 3, nonRetryableErrorTypes: ['INVALID_REQUEST','INVALID_PRICING_CONFIGURATION','PROPERTY_NOT_FOUND','VALIDATION_REJECTED'] } });
function terminalFailureCode(error: unknown): string {
 const cause = error instanceof ActivityFailure ? error.cause : undefined;
 const type = cause instanceof ApplicationFailure ? cause.type : undefined;
 return typeof type === 'string' && ['INVALID_REQUEST', 'INVALID_PRICING_CONFIGURATION', 'PROPERTY_NOT_FOUND', 'VALIDATION_REJECTED', 'PROVIDER_FAILURE', 'PERSISTENCE_FAILURE'].includes(type) ? type : 'WORKFLOW_FAILURE';
}
export async function GeneratePricingRecommendationWorkflow(request: PricingWorkflowRequest): Promise<{ status: 'accepted'|'rejected'|'failed'|'already_existing'; issue_codes: string[] }> {
 const workflowId = pricingWorkflowId(request);
 let resolved;
 try { resolved = await activity.resolvePricingRequest(request, workflowId); } catch (error) { if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && error.cause.type === 'INVALID_REQUEST') return { status: 'failed', issue_codes: [] }; throw error; }
 if (resolved.existing && ['accepted','rejected'].includes(resolved.status)) return { status: 'already_existing', issue_codes: [] };
 await activity.recordWorkflowStarted(request, workflowId);
 await activity.markPricingStatus(request, 'running');
 try { const loaded = await activity.loadPricingData(request); const data = await activity.calculatePricing(loaded); const ai = await activity.callPricingAi(request, data.deterministic); const validation = await activity.validatePricingAi(request, data, ai.output); if (!validation.valid) { await activity.markPricingStatus(request, 'rejected', validation.issue_codes); await activity.recordPricingMetrics(request, ai.metrics); await activity.recordWorkflowCompleted(request, 'rejected'); return { status: 'rejected', issue_codes: validation.issue_codes }; } const id = await activity.persistAcceptedPricing(request, data, validation.recommendation); await activity.recordPricingMetrics(request, ai.metrics, id); await activity.markPricingStatus(request, 'accepted'); await activity.recordWorkflowCompleted(request, 'accepted'); return { status: 'accepted', issue_codes: [] }; } catch (error) { const failureCode = terminalFailureCode(error); await activity.recordTerminalWorkflowFailure(request, failureCode); await activity.recordWorkflowCompleted(request, 'failed'); return { status: 'failed', issue_codes: [] }; }
}
