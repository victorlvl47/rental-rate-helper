import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { and, asc, count, desc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  aiCallMetrics,
  checkDatabaseConnection,
  closeDatabase,
  createRecommendationWorkflowRepository,
  db,
  marketSignals,
  properties,
  pricingRecommendations,
  pricingWorkflowRequests,
} from 'database';
import {
  calculateRuleBasedPricing,
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

const invalidAiOutputRequest: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  // Keep this separate from the retry, missing-property, and manual-test dates.
  pricing_date: `2099-09-${String((process.pid % 28) + 1).padStart(2, '0')}`,
};

const concurrentStartRequest: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  // The millisecond-derived year makes this request fresh across local test runs
  // without touching seeded or user-owned records.
  pricing_date: `${String(7000 + (Date.now() % 2000)).padStart(4, '0')}-08-16`,
};

const activeDuplicateRequest: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  pricing_date: `${String(5000 + (Date.now() % 2000)).padStart(4, '0')}-07-15`,
};

const policyConflictRequest: PricingWorkflowRequest = {
  property_id: '10000000-0000-4000-8000-000000000001',
  pricing_date: `${String(3000 + (Date.now() % 2000)).padStart(4, '0')}-06-14`,
};

const malformedWorkflowId = `malformed-pricing-request-${process.pid}-${Date.now()}`;

let worker: Worker | undefined;
let workerRun: Promise<void> | undefined;
let workerConnection: NativeConnection | undefined;
let clientConnection: Connection | undefined;
let client: Client | undefined;
let retryableFailureProviderCalls = 0;
let missingPropertyLoadAttempts = 0;
let missingPropertyProviderCalls = 0;
let invalidAiOutputProviderCalls = 0;
let malformedProviderCalls = 0;
let databaseReady = false;

function prerequisiteError(service: 'PostgreSQL' | 'Temporal', cause: unknown): Error {
  const detail = cause instanceof Error ? ` ${cause.message}` : '';
  return new Error(
    `${service} is required for this local integration test. Run pnpm infra:up, ` +
      'pnpm --filter database db:migrate, and pnpm --filter database db:seed first.' +
      detail,
  );
}

function flakyProvider() {
  let calls = 0;

  return {
    provider: {
      async getRecommendation(deterministic: RuleBasedPricingResult) {
        calls += 1;
        if (calls < 3) {
          throw new Error('test-only transient provider failure');
        }

        return {
          recommended_price: deterministic.recommended_price,
          explanation: 'Test-only retry recovery metadata from the deterministic result.',
          confidence_score: 0.8,
          risk_level: 'low',
        };
      },
    } satisfies AiPricingProvider,
    calls: () => calls,
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

function invalidAiOutputProvider(): AiPricingProvider {
  return {
    async getRecommendation(deterministic: RuleBasedPricingResult) {
      invalidAiOutputProviderCalls += 1;
      return {
        recommended_price: deterministic.recommended_price + 0.01,
        explanation: 'Test-only invalid AI metadata that must not be persisted publicly.',
        confidence_score: 0.8,
        risk_level: 'low',
      };
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
    repository: createRecommendationWorkflowRepository(),
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

      for (const scopedRequest of [request, retryableFailureRequest, missingPropertyRequest, invalidAiOutputRequest, concurrentStartRequest, activeDuplicateRequest, policyConflictRequest]) {
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
  it('returns an already-started response only after the first workflow is active', async () => {
    let releaseProvider: (() => void) | undefined;
    const providerEntered = new Promise<void>((resolve) => {
      setPricingActivityDependencies({
        provider: {
          async getRecommendation(deterministic) {
            resolve();
            await new Promise<void>((release) => { releaseProvider = release; });
            return { recommended_price: deterministic.recommended_price, explanation: 'Active duplicate test metadata.', confidence_score: 0.8, risk_level: 'low' };
          },
        },
      });
    });
    const { createApp } = await import(new URL('../../../api/src/app.js', import.meta.url).href);
    const app = createApp({ logger: false, closeDatabase: async () => undefined });
    const start = () => app.inject({ method: 'POST', url: `/properties/${activeDuplicateRequest.property_id}/pricing-recommendations`, payload: { pricing_date: activeDuplicateRequest.pricing_date } });
    try {
      const first = await start();
      expect.soft(first.statusCode).toBe(202);
      await providerEntered;
      const workflowId = pricingWorkflowId(activeDuplicateRequest);
      const description = await client!.workflow.getHandle(workflowId).describe();
      expect.soft(description.status.name).toBe('RUNNING');
      const second = await start();
      expect.soft(second.statusCode).toBe(200);
      expect.soft(first.json()).toMatchObject({ workflow_id: workflowId, already_started: false });
      expect.soft(second.json()).toEqual({ workflow_id: workflowId, status: 'pending', already_started: true });
      expect.soft(`${first.body}${second.body}`).not.toMatch(/database|unique|constraint/i);
      releaseProvider?.();
      expect.soft(await client!.workflow.getHandle(workflowId).result()).toEqual({ status: 'accepted', issue_codes: [] });
      const requestFilter = and(eq(pricingWorkflowRequests.property_id, activeDuplicateRequest.property_id), eq(pricingWorkflowRequests.pricing_date, activeDuplicateRequest.pricing_date));
      const [{ requestCount }] = await db.select({ requestCount: count() }).from(pricingWorkflowRequests).where(requestFilter);
      const [{ recommendationCount }] = await db.select({ recommendationCount: count() }).from(pricingRecommendations).where(and(eq(pricingRecommendations.property_id, activeDuplicateRequest.property_id), eq(pricingRecommendations.pricing_date, activeDuplicateRequest.pricing_date)));
      expect.soft(requestCount).toBe(1);
      expect.soft(recommendationCount).toBe(1);
    } finally { releaseProvider?.(); await app.close(); }
  }, 20_000);

  it('concurrently starts one active pricing workflow and resolves the duplicate safely', async () => {
    let markAiStarted: (() => void) | undefined;
    let releaseAi: (() => void) | undefined;
    const aiStarted = new Promise<void>((resolve) => { markAiStarted = resolve; });
    const aiReleased = new Promise<void>((resolve) => { releaseAi = resolve; });

    setPricingActivityDependencies({
      provider: {
        async getRecommendation(deterministic) {
          markAiStarted?.();
          await aiReleased;
          return {
            recommended_price: deterministic.recommended_price,
            explanation: 'Concurrent-start test metadata from the deterministic result.',
            confidence_score: 0.8,
            risk_level: 'low',
          };
        },
      },
    });

    // This app shares the integration harness's database client; closing the
    // Fastify instance must not close that shared client between test cases.
    const { createApp } = await import(new URL('../../../api/src/app.js', import.meta.url).href);
    const app = createApp({ logger: false, closeDatabase: async () => undefined });
    const start = () => app.inject({
      method: 'POST',
      url: `/properties/${concurrentStartRequest.property_id}/pricing-recommendations`,
      payload: { pricing_date: concurrentStartRequest.pricing_date },
    });

    try {
      const responses = await Promise.all([start(), start()]);
      const bodies = responses.map((response) => response.json() as {
        workflow_id: string;
        already_started: boolean;
      });
      const workflowId = pricingWorkflowId(concurrentStartRequest);

      expect.soft(responses.map((response) => response.statusCode).sort()).toEqual([200, 202]);
      expect.soft(bodies.map((body) => body.workflow_id)).toEqual([workflowId, workflowId]);
      expect.soft(bodies.map((body) => body.already_started).sort()).toEqual([false, true]);
      expect.soft(responses.every((response) => !/database|unique|constraint/i.test(response.body))).toBe(true);

      // Do not let the successful workflow finish until both starts have raced.
      await aiStarted;
      releaseAi?.();

      const workflowResult = await client!.workflow.getHandle(workflowId).result();
      const requestFilter = and(
        eq(pricingWorkflowRequests.property_id, concurrentStartRequest.property_id),
        eq(pricingWorkflowRequests.pricing_date, concurrentStartRequest.pricing_date),
      );
      const [{ requestCount }] = await db
        .select({ requestCount: count() })
        .from(pricingWorkflowRequests)
        .where(requestFilter);
      const [{ recommendationCount }] = await db
        .select({ recommendationCount: count() })
        .from(pricingRecommendations)
        .where(and(
          eq(pricingRecommendations.property_id, concurrentStartRequest.property_id),
          eq(pricingRecommendations.pricing_date, concurrentStartRequest.pricing_date),
        ));
      const statusResponse = await app.inject({
        method: 'GET',
        url: `/properties/${concurrentStartRequest.property_id}/pricing-recommendations/status?pricing_date=${concurrentStartRequest.pricing_date}`,
      });

      expect.soft(workflowResult).toEqual({ status: 'accepted', issue_codes: [] });
      expect.soft(requestCount).toBe(1);
      expect.soft(recommendationCount).toBe(1);
      expect.soft(statusResponse.statusCode).toBe(200);
      expect.soft(statusResponse.json()).toMatchObject({
        workflow_id: workflowId,
        status: 'accepted',
      });
    } finally {
      releaseAi?.();
      await app.close();
    }
  }, 20_000);

  it('retries two transient provider failures and persists one accepted result', async () => {
    const flaky = flakyProvider();
    setPricingActivityDependencies({ provider: flaky.provider });

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

    expect.soft(flaky.calls()).toBe(3);
    expect.soft(workflowResult).toEqual({ status: 'accepted', issue_codes: [] });
    expect.soft(status?.status).toBe('accepted');
    expect.soft(recommendationCount).toBe(1);
    expect.soft(status?.recommendation?.deterministic).toEqual(persistedRecommendation?.deterministic);
    expect.soft(status?.recommendation?.deterministic.recommended_price).toBe(
      status?.recommendation?.ai_metadata.recommended_price,
    );
    expect.soft(status?.metrics).toMatchObject({ success: true });
    expect.soft(metrics).toHaveLength(3);
    expect.soft(metrics.filter((metric) => metric.success === 0)).toHaveLength(2);
    expect.soft(metrics.filter((metric) => metric.success === 1)).toHaveLength(1);
    expect.soft(metrics.find((metric) => metric.success === 1)?.recommendation_id).toBeTruthy();
    expect.soft(metrics.filter((metric) => metric.success === 0).every((metric) => metric.recommendation_id === null)).toBe(true);
  }, 20_000);

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
  }, 20_000);

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
    const workflowResult = await handle.result();
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
  }, 20_000);

  it('rejects invalid AI metadata without retrying or persisting a recommendation', async () => {
    invalidAiOutputProviderCalls = 0;
    setPricingActivityDependencies({ provider: invalidAiOutputProvider() });

    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', {
      taskQueue: temporalTaskQueue,
      workflowId: pricingWorkflowId(invalidAiOutputRequest),
      args: [invalidAiOutputRequest],
    });
    const workflowResult = await handle.result();
    const requestFilter = and(
      eq(pricingWorkflowRequests.property_id, invalidAiOutputRequest.property_id),
      eq(pricingWorkflowRequests.pricing_date, invalidAiOutputRequest.pricing_date),
    );
    const status = await (await import('database')).createRecommendationWorkflowRepository().getStatus(invalidAiOutputRequest);
    const [{ recommendationCount }] = await db
      .select({ recommendationCount: count() })
      .from(pricingRecommendations)
      .where(and(
        eq(pricingRecommendations.property_id, invalidAiOutputRequest.property_id),
        eq(pricingRecommendations.pricing_date, invalidAiOutputRequest.pricing_date),
      ));
    const metrics = await db
      .select({ success: aiCallMetrics.success, recommendation_id: aiCallMetrics.recommendation_id })
      .from(aiCallMetrics)
      .innerJoin(pricingWorkflowRequests, eq(aiCallMetrics.request_id, pricingWorkflowRequests.id))
      .where(requestFilter)
      .orderBy(desc(aiCallMetrics.created_at));

    expect.soft(invalidAiOutputProviderCalls).toBe(1);
    expect.soft(workflowResult).toEqual({ status: 'rejected', issue_codes: ['price_mismatch_authoritative_result'] });
    expect.soft(status).toMatchObject({
      status: 'rejected',
      issue_codes: ['price_mismatch_authoritative_result'],
      recommendation: null,
      metrics: { success: true },
    });
    expect.soft(recommendationCount).toBe(0);
    expect.soft(metrics).toHaveLength(1);
    expect.soft(metrics[0]).toEqual({ success: 1, recommendation_id: null });
    expect.soft(JSON.stringify({ workflowResult, status })).not.toMatch(/test-only invalid|credentials|internal exception/i);
  }, 20_000);

  it('rejects an authoritative deterministic increase above 30% through Temporal without mutating it', async () => {
    const property = await databaseRentalDataRepository().findPropertyById(policyConflictRequest.property_id);
    if (!property) throw new Error('Seeded policy-conflict property is required.');
    const policyProperty = { ...property, current_occupancy_rate: 0.6, target_occupancy_rate: 0.8 };
    const highSignals: MarketSignal[] = [{ property_id: policyProperty.id, date: '2026-01-01', competitor_avg_price: policyProperty.base_price * 1.2, local_event_score: 1, seasonality_score: 1, demand_score: 1 }];
    const expectedDeterministic = calculateRuleBasedPricing(policyProperty, highSignals);
    let authoritativePrice: number | undefined;
    setPricingActivityDependencies({ rentalDataRepository: { findPropertyById: async () => policyProperty, listMarketSignals: async () => highSignals }, provider: { getRecommendation: async (deterministic) => { authoritativePrice = deterministic.recommended_price; return { recommended_price: deterministic.recommended_price, explanation: 'Policy-conflict test metadata.', confidence_score: 0.8, risk_level: 'low' }; } } });
    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', { taskQueue: temporalTaskQueue, workflowId: pricingWorkflowId(policyConflictRequest), args: [policyConflictRequest] });
    const result = await handle.result();
    const status = await (await import('database')).createRecommendationWorkflowRepository().getStatus(policyConflictRequest);
    const [recommendation] = await db.select().from(pricingRecommendations).where(and(eq(pricingRecommendations.property_id, policyConflictRequest.property_id), eq(pricingRecommendations.pricing_date, policyConflictRequest.pricing_date))).limit(1);
    expect.soft(result).toEqual({ status: 'rejected', issue_codes: ['authoritative_result_exceeds_30_percent'] });
    expect.soft(status).toMatchObject({ status: 'rejected', issue_codes: ['authoritative_result_exceeds_30_percent'], recommendation: null });
    expect.soft(recommendation).toBeUndefined();
    expect.soft(expectedDeterministic.adjustments.total).toBeGreaterThan(0.3);
    expect.soft(expectedDeterministic.adjustments.total).toBeLessThanOrEqual(0.35);
    expect.soft(authoritativePrice).toBe(expectedDeterministic.recommended_price);
  }, 20_000);

  it('safely terminates a malformed direct workflow input after one non-retryable boundary check', async () => {
    malformedProviderCalls = 0;
    let repositoryCalls = 0;
    setPricingActivityDependencies({
      repository: { createOrResolve: async () => { repositoryCalls += 1; throw new Error('must not persist malformed input'); }, updateStatus: async () => undefined, saveAccepted: async () => 'unused', saveMetrics: async () => undefined, getStatus: async () => undefined },
      provider: { getRecommendation: async () => { malformedProviderCalls += 1; throw new Error('must not call provider'); } },
    });
    const handle = await client!.workflow.start('GeneratePricingRecommendationWorkflow', { taskQueue: temporalTaskQueue, workflowId: malformedWorkflowId, args: [{ property_id: 'not-a-uuid', pricing_date: '2099-01-01' } as unknown as PricingWorkflowRequest] });
    const result = await handle.result();
    const history = await handle.fetchHistory();
    const resolveAttempts = (history.events ?? []).filter((event) => event.activityTaskScheduledEventAttributes?.activityType?.name === 'resolvePricingRequest');
    expect.soft(result).toEqual({ status: 'failed', issue_codes: [] });
    expect.soft(resolveAttempts).toHaveLength(1);
    expect.soft(repositoryCalls).toBe(0);
    expect.soft(malformedProviderCalls).toBe(0);
    expect.soft(JSON.stringify(result)).not.toMatch(/not-a-uuid|credentials|stack|internal/i);
  }, 20_000);
});
