import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { and, count, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  aiCallMetrics,
  checkDatabaseConnection,
  closeDatabase,
  db,
  pricingRecommendations,
  pricingWorkflowRequests,
} from 'database';
import {
  createConfiguredAiPricingProvider,
  type AiPricingProvider,
} from 'pricing';
import { pricingWorkflowId, type PricingWorkflowRequest, type RuleBasedPricingResult } from 'shared';
import { setPricingActivityDependencies } from '../activities/pricing-recommendation-activity.js';
import { temporalAddress, temporalTaskQueue } from '../config.js';

const request: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  // This test-only date must not overlap the fixed seed dates or manual workflow examples.
  pricing_date: `2099-12-${String((process.pid % 28) + 1).padStart(2, '0')}`,
};

const retryableFailureRequest: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  // Keep this separate from the retry-recovery request and all fixed seed dates.
  pricing_date: `2099-11-${String((process.pid % 28) + 1).padStart(2, '0')}`,
};

let worker: Worker | undefined;
let workerRun: Promise<void> | undefined;
let workerConnection: NativeConnection | undefined;
let clientConnection: Connection | undefined;
let client: Client | undefined;
let providerCalls = 0;
let retryableFailureProviderCalls = 0;
let databaseReady = false;

function prerequisiteError(service: 'PostgreSQL' | 'Temporal', cause: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : '';
  return new Error(
    `${service} is required for this local integration test. Run pnpm infra:up, ` +
      'pnpm --filter database db:migrate, and pnpm --filter database db:seed first.' +
      detail,
  );
}

function flakyProvider(): AiPricingProvider {
  return {
    async getRecommendation(deterministic: RuleBasedPricingResult) {
      providerCalls += 1;
      if (providerCalls < 3) {
        throw new Error('test-only transient provider failure');
      }

      return {
        recommended_price: deterministic.recommended_price,
        explanation: 'Test-only retry recovery metadata from the deterministic result.',
        confidence_score: 0.8,
        risk_level: 'low',
      };
    },
  };
}

function repeatedlyFailingRetryableProvider(): AiPricingProvider {
  return {
    async getRecommendation() {
      retryableFailureProviderCalls += 1;
      throw new Error('test-only retryable provider failure');
    },
  };
}

beforeAll(async () => {
  try {
    await checkDatabaseConnection();
    databaseReady = true;
  } catch (error) {
    throw prerequisiteError('PostgreSQL', error);
  }

  try {
    workerConnection = await NativeConnection.connect({ address: temporalAddress });
    clientConnection = await Connection.connect({ address: temporalAddress });
  } catch (error) {
    throw prerequisiteError('Temporal', error);
  }

  setPricingActivityDependencies({ provider: flakyProvider() });
  worker = await Worker.create({
    activities: await import('../activities/pricing-recommendation-activity.js'),
    connection: workerConnection,
    taskQueue: temporalTaskQueue,
    workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
  });
  workerRun = worker.run();
  client = new Client({ connection: clientConnection });
});

afterEach(() => {
  // This test changes only the existing provider seam; leave later tests with the configured provider.
  setPricingActivityDependencies({ provider: createConfiguredAiPricingProvider() });
});

afterAll(async () => {
  try {
    await worker?.shutdown();
    await workerRun?.catch(() => undefined);
    await clientConnection?.close();
    await workerConnection?.close();
  } finally {
    setPricingActivityDependencies({ provider: createConfiguredAiPricingProvider() });

    try {
      if (!databaseReady) return;

      for (const scopedRequest of [request, retryableFailureRequest]) {
        const requestFilter = and(
          eq(pricingWorkflowRequests.property_id, scopedRequest.property_id),
          eq(pricingWorkflowRequests.pricing_date, scopedRequest.pricing_date),
        );
        const [workflowRequest] = await db
          .select({ id: pricingWorkflowRequests.id })
          .from(pricingWorkflowRequests)
          .where(requestFilter)
          .limit(1);

        if (workflowRequest) {
          await db.delete(aiCallMetrics).where(eq(aiCallMetrics.request_id, workflowRequest.id));
          await db.delete(pricingRecommendations).where(eq(pricingRecommendations.request_id, workflowRequest.id));
          await db.delete(pricingWorkflowRequests).where(requestFilter);
        }
      }
    } finally {
      await closeDatabase();
    }
  }
});

describe.sequential('Temporal pricing retry recovery (local integration)', () => {
  it('retries two transient provider failures and persists one accepted result', async () => {
    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', {
      taskQueue: temporalTaskQueue,
      workflowId: pricingWorkflowId(request),
      args: [request],
    });
    const workflowResult = await handle.result();
    const requestFilter = and(
      eq(pricingWorkflowRequests.property_id, request.property_id),
      eq(pricingWorkflowRequests.pricing_date, request.pricing_date),
    );
    const status = await (await import('database')).createRecommendationWorkflowRepository().getStatus(request);
    const [{ recommendationCount }] = await db
      .select({ recommendationCount: count() })
      .from(pricingRecommendations)
      .where(and(eq(pricingRecommendations.property_id, request.property_id), eq(pricingRecommendations.pricing_date, request.pricing_date)));
    const [persistedRecommendation] = await db
      .select({ deterministic: pricingRecommendations.deterministic_result })
      .from(pricingRecommendations)
      .where(and(eq(pricingRecommendations.property_id, request.property_id), eq(pricingRecommendations.pricing_date, request.pricing_date)))
      .limit(1);
    const metrics = await db
      .select({ success: aiCallMetrics.success, recommendation_id: aiCallMetrics.recommendation_id })
      .from(aiCallMetrics)
      .innerJoin(pricingWorkflowRequests, eq(aiCallMetrics.request_id, pricingWorkflowRequests.id))
      .where(requestFilter)
      .orderBy(desc(aiCallMetrics.created_at));

    expect.soft(providerCalls).toBe(3);
    expect.soft(workflowResult).toEqual({ status: 'accepted', issue_codes: [] });
    expect.soft(status?.status).toBe('accepted');
    expect.soft(recommendationCount).toBe(1);
    expect.soft(status?.recommendation?.deterministic).toEqual(persistedRecommendation?.deterministic);
    expect.soft(status?.recommendation?.deterministic.recommended_price).toBe(
      status?.recommendation?.ai_metadata.recommended_price,
    );
    expect.soft(status?.metrics).toMatchObject({ success: true });
    expect.soft(metrics.filter((metric) => metric.success === 1)).toHaveLength(1);
    expect.soft(metrics.find((metric) => metric.success === 1)?.recommendation_id).toBeTruthy();
  });

  it('stops after three retryable provider failures and safely persists no recommendation', async () => {
    retryableFailureProviderCalls = 0;
    setPricingActivityDependencies({ provider: repeatedlyFailingRetryableProvider() });

    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', {
      taskQueue: temporalTaskQueue,
      workflowId: pricingWorkflowId(retryableFailureRequest),
      args: [retryableFailureRequest],
    });
    const workflowResult = await handle.result();
    const requestFilter = and(
      eq(pricingWorkflowRequests.property_id, retryableFailureRequest.property_id),
      eq(pricingWorkflowRequests.pricing_date, retryableFailureRequest.pricing_date),
    );
    const status = await (await import('database')).createRecommendationWorkflowRepository().getStatus(retryableFailureRequest);
    const [{ recommendationCount }] = await db
      .select({ recommendationCount: count() })
      .from(pricingRecommendations)
      .where(and(
        eq(pricingRecommendations.property_id, retryableFailureRequest.property_id),
        eq(pricingRecommendations.pricing_date, retryableFailureRequest.pricing_date),
      ));
    const metrics = await db
      .select({ success: aiCallMetrics.success })
      .from(aiCallMetrics)
      .innerJoin(pricingWorkflowRequests, eq(aiCallMetrics.request_id, pricingWorkflowRequests.id))
      .where(requestFilter)
      .orderBy(desc(aiCallMetrics.created_at));

    expect.soft(retryableFailureProviderCalls).toBe(3);
    expect.soft(workflowResult).toEqual({ status: 'failed', issue_codes: [] });
    expect.soft(status).toMatchObject({
      status: 'failed',
      issue_codes: [],
      recommendation: null,
      metrics: { success: false },
    });
    expect.soft(recommendationCount).toBe(0);
    expect.soft(metrics).toHaveLength(3);
    expect.soft(metrics.every((metric) => metric.success === 0)).toBe(true);
    expect.soft(metrics.some((metric) => metric.success === 1)).toBe(false);
    expect.soft(JSON.stringify(status)).not.toContain('test-only retryable provider failure');
  });
});
