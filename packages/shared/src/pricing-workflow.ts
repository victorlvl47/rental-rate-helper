import { z } from 'zod';
import { aiPricingRecommendationSchema } from './ai-pricing-recommendation.js';
import { calendarDateSchema, propertySchema, marketSignalSchema, usdAmountSchema } from './rental-market.js';
import { recommendationValidationIssueCodeSchema } from './recommendation-validation.js';
import { ruleBasedPricingResultSchema } from './rule-based-pricing.js';

export const pricingWorkflowRequestSchema = z.object({ property_id: z.uuid(), pricing_date: calendarDateSchema }).strict();
export type PricingWorkflowRequest = z.infer<typeof pricingWorkflowRequestSchema>;
export const pricingWorkflowStatusSchema = z.enum(['pending', 'running', 'accepted', 'rejected', 'failed']);
export type PricingWorkflowStatus = z.infer<typeof pricingWorkflowStatusSchema>;
export const aiCallMetricsSchema = z.object({ model: z.string().min(1), prompt_version: z.string().min(1), input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(), estimated_cost_usd: usdAmountSchema.nullable(), latency_ms: z.number().int().nonnegative(), success: z.boolean() }).strict();
export type AiCallMetrics = z.infer<typeof aiCallMetricsSchema>;
export const pricingWorkflowStatusResultSchema = z.object({ property_id: z.uuid(), pricing_date: calendarDateSchema, workflow_id: z.string().min(1), status: pricingWorkflowStatusSchema, issue_codes: z.array(recommendationValidationIssueCodeSchema), recommendation: z.object({ deterministic: ruleBasedPricingResultSchema, ai_metadata: aiPricingRecommendationSchema }).nullable(), metrics: aiCallMetricsSchema.nullable() }).strict();
export type PricingWorkflowStatusResult = z.infer<typeof pricingWorkflowStatusResultSchema>;
export const pricingWorkflowDataSchema = z.object({ property: propertySchema, signals: z.array(marketSignalSchema), deterministic: ruleBasedPricingResultSchema }).strict();
export type PricingWorkflowData = z.infer<typeof pricingWorkflowDataSchema>;

export function pricingWorkflowId(request: PricingWorkflowRequest): string {
  return `pricing-${request.property_id}-${request.pricing_date}`;
}
