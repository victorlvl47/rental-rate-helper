import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  aiCallMetrics,
  checkDatabaseConnection,
  closeDatabase,
  db,
  marketSignals,
  properties,
  pricingRecommendations,
  pricingWorkflowRequests,
} from 'database';
import {
  createConfiguredAiPricingProvider,
  type AiPricingProvider,
} from 'pricing';
import {
  marketSignalSchema,
  pricingWorkflowId,
  propertySchema,
  type MarketSignal,
  type PricingWorkflowRequest,
  type Property,
  type RuleBasedPricingResult,
} from 'shared';
import {
  setPricingActivityDependencies,
  type RentalDataRepository,
} from '../activities/pricing-recommendation-activity.js';
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

const missingPropertyRequest: PricingWorkflowRequest = {
  // This valid UUID is deliberately absent from the local seeded database.
  property_id: '20000000-0000-4000-8000-000000000001',
  // Keep this separate from the existing integration and manual-test dates.
  pricing_date: `2099-10-${String((process.pid % 28) + 1).padStart(2, '0')}`,
};

let worker: Worker | undefined;
let workerRun: Promise<void> | undefined;
let workerConnection: NativeConnection | undefined;
let clientConnection: Connection | undefined;
let client: Client | undefined;
let providerCalls = 0;
let retryableFailureProviderCalls = 0;
let missingPropertyLoadAttempts = 0;
let missingPropertyProviderCalls = 0;
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

function databaseRentalDataRepository(): RentalDataRepository {
  const number = (value: string | number) => typeof value === 'number' ? value : Number(value);

  return {
    async findPropertyById(id): Promise<Property | undefined> {
      const [row] = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
      return row === undefined ? undefined : propertySchema.parse({
        ...row,
        base_price: number(row.base_price),
        min_price: number(row.min_price),
        max_price: number(row.max_price),
        bathrooms: number(row.bathrooms),
        current_occupancy_rate: number(row.current_occupancy_rate),
        target_occupancy_rate: number(row.target_occupancy_rate),
      });
    },
    async listMarketSignals(id): Promise<MarketSignal[]> {
      const rows = await db.select().from(marketSignals).where(eq(marketSignals.property_id, id)).orderBy(asc(marketSignals.date));
      return rows.map((row) => marketSignalSchema.parse({
        ...row,
        competitor_avg_price: number(row.competitor_avg_price),
        local_event_score: number(row.local_event_score),
        seasonality_score: number(row.seasonality_score),
        demand_score: number(row.demand_score),
      }));
    },
  };
}

function missingPropertyRepository(): RentalDataRepository {
  return {
    async findPropertyById() {
      missingPropertyLoadAttempts += 1;
      return undefined;
    },
    async listMarketSignals() {
      throw new Error('listMarketSignals must not run when the property is missing.');
    },
  };
}

function noCallProvider(): AiPricingProvider {
  return {
    async getRecommendation() {
      missingPropertyProviderCalls += 1;
      throw new Error('AI provider must not run when the property is missing.');
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
  // Restore all overridden seams so every scenario continues to use real local persistence.
  setPricingActivityDependencies({
    provider: createConfiguredAiPricingProvider(),
    rentalDataRepository: databaseRentalDataRepository(),
  });
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

      for (const scopedRequest of [request, retryableFailureRequest, missingPropertyRequest]) {
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

  it('does not retry a missing property and safely persists only the failed status', async () => {
    missingPropertyLoadAttempts = 0;
    missingPropertyProviderCalls = 0;
    setPricingActivityDependencies({
      rentalDataRepository: missingPropertyRepository(),
      provider: noCallProvider(),
    });

    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', {
      taskQueue: temporalTaskQueue,
      workflowId: pricingWorkflowId(missingPropertyRequest),
      args: [missingPropertyRequest],
    });
    const workflowResult = await handle.result().catch(() => undefined);
    const requestFilter = and(
      eq(pricingWorkflowRequests.property_id, missingPropertyRequest.property_id),
      eq(pricingWorkflowRequests.pricing_date, missingPropertyRequest.pricing_date),
    );
    const status = await (await import('database')).createRecommendationWorkflowRepository().getStatus(missingPropertyRequest);
    const [{ recommendationCount }] = await db
      .select({ recommendationCount: count() })
      .from(pricingRecommendations)
      .where(and(
        eq(pricingRecommendations.property_id, missingPropertyRequest.property_id),
        eq(pricingRecommendations.pricing_date, missingPropertyRequest.pricing_date),
      ));
    const [{ metricsCount }] = await db
      .select({ metricsCount: count() })
      .from(aiCallMetrics)
      .innerJoin(pricingWorkflowRequests, eq(aiCallMetrics.request_id, pricingWorkflowRequests.id))
      .where(requestFilter);

    expect.soft(missingPropertyLoadAttempts).toBe(1);
    expect.soft(workflowResult).toEqual({ status: 'failed', issue_codes: [] });
    expect.soft(status).toMatchObject({
      status: 'failed',
      issue_codes: [],
      recommendation: null,
      metrics: null,
    });
    expect.soft(missingPropertyProviderCalls).toBe(0);
    expect.soft(recommendationCount).toBe(0);
    expect.soft(metricsCount).toBe(0);
    expect.soft(JSON.stringify(status ?? {})).not.toMatch(/database|provider|Property not found/i);
  });
});
