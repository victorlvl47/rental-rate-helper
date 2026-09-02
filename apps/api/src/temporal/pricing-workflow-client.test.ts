import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/common';
import { describe, expect, it, vi } from 'vitest';
import { pricingWorkflowId, type PricingWorkflowRequest } from 'shared';
import { createPricingWorkflowClient } from './pricing-workflow-client.js';

const request: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  pricing_date: '2026-09-16',
};

function dependencies(start: ReturnType<typeof vi.fn>) {
  const close = vi.fn(async () => undefined);
  return {
    connect: vi.fn(async () => ({ close })) as never,
    createClient: vi.fn(() => ({ workflow: { start } })) as never,
    close,
  };
}

describe('pricing workflow Temporal client', () => {
  it('starts new workflows using strict active and closed-ID duplicate policies', async () => {
    const start = vi.fn(async () => undefined);
    const fake = dependencies(start);
    const result = await createPricingWorkflowClient(fake).startOrResolve(request);

    expect(result).toEqual({ workflow_id: pricingWorkflowId(request), started: true });
    expect(start).toHaveBeenCalledWith('GeneratePricingRecommendationWorkflow', expect.objectContaining({
      workflowId: pricingWorkflowId(request),
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    }));
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it.each(['running', 'completed'])('maps a real SDK duplicate error for a %s workflow to the existing logical request', async () => {
    const start = vi.fn(async () => { throw new WorkflowExecutionAlreadyStartedError('ignored test message', pricingWorkflowId(request), 'GeneratePricingRecommendationWorkflow'); });
    const result = await createPricingWorkflowClient(dependencies(start)).startOrResolve(request);

    expect(result).toEqual({ workflow_id: pricingWorkflowId(request), started: false });
  });

  it('preserves unrelated Temporal failures for the API to return as a safe 503', async () => {
    const client = createPricingWorkflowClient(dependencies(vi.fn(async () => { throw new Error('connection unavailable'); })));
    await expect(client.startOrResolve(request)).rejects.toThrow('connection unavailable');
  });
});
