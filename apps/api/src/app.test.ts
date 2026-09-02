import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiPricingPreviewResponseSchema,
  aiPricingValidationRejectionResponseSchema,
  marketSignalSchema,
  propertySchema,
  RENTAL_MARKETS,
  ruleBasedPricingResultSchema,
  type MarketSignal,
  type Property,
} from 'shared';
import type { AiPricingProvider } from './ai/ai-pricing-provider.js';
import { stubAiPricingProvider } from './ai/stub-ai-pricing-provider.js';
import { createApp, type ApiDependencies } from './app.js';
import { calculateRuleBasedPricing } from './pricing/rule-based-pricing.js';
import type { RentalDataRepository } from './rental-data-repository.js';
import type { RecommendationWorkflowRepository } from 'database';
import type { PricingWorkflowClient } from './temporal/pricing-workflow-client.js';

const property: Property = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Sample Harbor Studio',
  city: 'New York',
  base_price: 185,
  min_price: 135,
  max_price: 255,
  bedrooms: 0,
  bathrooms: 1,
  max_guests: 2,
  current_occupancy_rate: 0.72,
  target_occupancy_rate: 0.78,
};

const signals: MarketSignal[] = [
  {
    property_id: property.id,
    date: '2026-09-14',
    competitor_avg_price: 175,
    local_event_score: 0.65,
    seasonality_score: 0.72,
    demand_score: 0.76,
  },
  {
    property_id: property.id,
    date: '2026-10-18',
    competitor_avg_price: 225.5,
    local_event_score: 0.9,
    seasonality_score: 0.81,
    demand_score: 0.88,
  },
];

const repository: RentalDataRepository = {
  listProperties: async () => [property],
  findPropertyById: async (propertyId) => (propertyId === property.id ? property : undefined),
  listMarketSignals: async () => signals,
};

const apps: ReturnType<typeof createApp>[] = [];

function createTestApp(
  overrides: Partial<RentalDataRepository> & Record<string, unknown> = {},
  dependencyOverrides: Partial<Pick<ApiDependencies, 'aiPricingProvider' | 'calculateRuleBasedPricing'>> = {},
) {
  const app = createApp({
    logger: false,
    checkDatabaseConnection: async () => undefined,
    closeDatabase: async () => undefined,
    rentalDataRepository: { ...repository, ...overrides },
    aiPricingProvider: stubAiPricingProvider,
    calculateRuleBasedPricing,
    ...dependencyOverrides,
  });

  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('pricing workflow routes', () => {
  const workflowClient: PricingWorkflowClient = { startOrResolve: vi.fn(async (request) => ({ workflow_id: `pricing-${request.property_id}-${request.pricing_date}`, started: true })) };
  const workflowRepository: RecommendationWorkflowRepository = {
    createOrResolve: async () => { throw new Error('not used by API'); }, updateStatus: async () => undefined, saveAccepted: async () => 'recommendation-id', saveMetrics: async () => undefined,
    getStatus: async (request) => ({ property_id: request.property_id, pricing_date: request.pricing_date, workflow_id: `pricing-${request.property_id}-${request.pricing_date}`, status: 'accepted', issue_codes: [], recommendation: { deterministic: calculateRuleBasedPricing(property, signals), ai_metadata: { recommended_price: calculateRuleBasedPricing(property, signals).recommended_price, explanation: 'Stored metadata.', confidence_score: 0.8, risk_level: 'low' } }, metrics: { model: 'stub', prompt_version: 'v1', input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: 0, success: true } }),
  };
  function appWithWorkflow(overrides: Partial<ApiDependencies> = {}) {
    const app = createApp({ logger: false, checkDatabaseConnection: async () => undefined, closeDatabase: async () => undefined, rentalDataRepository: repository, aiPricingProvider: stubAiPricingProvider, calculateRuleBasedPricing, pricingWorkflowClient: workflowClient, recommendationWorkflowRepository: workflowRepository, ...overrides }); apps.push(app); return app;
  }
  it('starts a valid request and reports an existing workflow truthfully', async () => {
    const first = await appWithWorkflow().inject({ method: 'POST', url: `/properties/${property.id}/pricing-recommendations`, payload: { pricing_date: '2026-09-14' } });
    expect(first.statusCode).toBe(202); expect(first.json()).toMatchObject({ already_started: false });
    const duplicateClient: PricingWorkflowClient = { startOrResolve: async (request) => ({ workflow_id: `pricing-${request.property_id}-${request.pricing_date}`, started: false }) };
    const duplicate = await appWithWorkflow({ pricingWorkflowClient: duplicateClient }).inject({ method: 'POST', url: `/properties/${property.id}/pricing-recommendations`, payload: { pricing_date: '2026-09-14' } });
    expect(duplicate.statusCode).toBe(200); expect(duplicate.json()).toMatchObject({ already_started: true });
  });
  it('rejects invalid start input and safely contains Temporal failures', async () => {
    expect((await appWithWorkflow().inject({ method: 'POST', url: '/properties/not-a-uuid/pricing-recommendations', payload: { pricing_date: 'bad' } })).statusCode).toBe(400);
    const app = appWithWorkflow({ pricingWorkflowClient: { startOrResolve: async () => { throw Object.assign(new Error('secret provider payload'), { code: 'UNAVAILABLE' }); } } });
    const logError = vi.spyOn(app.log, 'error');
    const response = await app.inject({ method: 'POST', url: `/properties/${property.id}/pricing-recommendations`, payload: { pricing_date: '2026-09-14' } });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('secret');
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ temporalStartError: expect.objectContaining({ name: 'Error', code: 'UNAVAILABLE', address: 'localhost:7233', workflow_id: `pricing-${property.id}-2026-09-14` }) }), 'Pricing workflow start failed');
    expect(JSON.stringify(logError.mock.calls)).not.toContain('secret');
  });
  it('returns truthful accepted status, safe rejection, not found, and repository failures', async () => {
    const accepted = await appWithWorkflow().inject({ method: 'GET', url: `/properties/${property.id}/pricing-recommendations/status?pricing_date=2026-09-14` });
    expect(accepted.statusCode).toBe(200); expect(accepted.json().recommendation.deterministic).toEqual(calculateRuleBasedPricing(property, signals));
    const rejected = await appWithWorkflow({ recommendationWorkflowRepository: { ...workflowRepository, getStatus: async (request) => ({ property_id: request.property_id, pricing_date: request.pricing_date, workflow_id: 'pricing-id', status: 'rejected', issue_codes: ['malformed_recommendation'], recommendation: null, metrics: { model: 'stub', prompt_version: 'v1', input_tokens: null, output_tokens: null, estimated_cost_usd: null, latency_ms: 1, success: true } }) } }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-recommendations/status?pricing_date=2026-09-14` });
    expect(rejected.json()).toMatchObject({ status: 'rejected', recommendation: null, issue_codes: ['malformed_recommendation'] });
    expect((await appWithWorkflow({ recommendationWorkflowRepository: { ...workflowRepository, getStatus: async () => undefined } }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-recommendations/status?pricing_date=2026-09-14` })).statusCode).toBe(404);
    expect((await appWithWorkflow({ recommendationWorkflowRepository: { ...workflowRepository, getStatus: async () => { throw new Error('postgres://secret'); } } }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-recommendations/status?pricing_date=2026-09-14` })).statusCode).toBe(503);
  });
});

describe('rental market data routes', () => {
  it('lists exactly the supported markets', async () => {
    const response = await createTestApp().inject({ method: 'GET', url: '/markets' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RENTAL_MARKETS);
  });

  it('rejects missing and unsupported property cities', async () => {
    const app = createTestApp();

    expect((await app.inject({ method: 'GET', url: '/properties' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/properties?city=Unsupported' })).statusCode).toBe(400);
  });

  it('returns contract-valid properties with numeric prices', async () => {
    const response = await createTestApp().inject({
      method: 'GET',
      url: '/properties?city=New%20York',
    });
    const body = response.json<Property[]>();

    expect(response.statusCode).toBe(200);
    expect(propertySchema.array().parse(body)).toEqual(body);
    expect(typeof body[0]?.base_price).toBe('number');
  });

  it('returns an empty array for a valid city with no properties', async () => {
    const response = await createTestApp({ listProperties: async () => [] }).inject({
      method: 'GET',
      url: '/properties?city=Toronto',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('rejects invalid property IDs and returns 404 for unknown valid IDs', async () => {
    const app = createTestApp();

    expect(
      (await app.inject({ method: 'GET', url: '/properties/not-a-uuid/market-signals' })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/properties/10000000-0000-4000-8000-000000000099/market-signals',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('returns an empty array for an existing property with no signals', async () => {
    const response = await createTestApp({ listMarketSignals: async () => [] }).inject({
      method: 'GET',
      url: `/properties/${property.id}/market-signals`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('returns contract-valid signals in ascending date order with numeric prices', async () => {
    const response = await createTestApp().inject({
      method: 'GET',
      url: `/properties/${property.id}/market-signals`,
    });
    const body = response.json<MarketSignal[]>();

    expect(response.statusCode).toBe(200);
    expect(marketSignalSchema.array().parse(body)).toEqual(body);
    expect(body.map((signal) => signal.date)).toEqual(['2026-09-14', '2026-10-18']);
    expect(typeof body[0]?.competitor_avg_price).toBe('number');
  });

  it('returns a safe 503 for database failures', async () => {
    const response = await createTestApp({
      listProperties: async () => {
        throw new Error('postgresql://username:secret@host/database');
      },
    }).inject({ method: 'GET', url: '/properties?city=New%20York' });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });

  it('returns a safe 503 when loading market signals fails', async () => {
    const response = await createTestApp({
      listMarketSignals: async () => {
        throw new Error('postgresql://username:secret@host/database');
      },
    }).inject({ method: 'GET', url: `/properties/${property.id}/market-signals` });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });
});

describe('pricing preview route', () => {
  it('returns a schema-valid, cents-rounded pricing preview for a known property', async () => {
    const response = await createTestApp().inject({
      method: 'GET',
      url: `/properties/${property.id}/pricing-preview`,
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(ruleBasedPricingResultSchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({
      property_id: property.id,
      signal_count: signals.length,
      market_signals_used: true,
    });
    expect(body.adjustments).toBeDefined();
    expect(body).toEqual(calculateRuleBasedPricing(property, signals));

    for (const price of [
      body.minimum_recommended_price,
      body.recommended_price,
      body.maximum_recommended_price,
    ]) {
      expect(typeof price).toBe('number');
      expect(price).toBeGreaterThanOrEqual(property.min_price);
      expect(price).toBeLessThanOrEqual(property.max_price);
      expect(price * 100).toBeCloseTo(Math.round(price * 100), 8);
    }
  });

  it('rejects an invalid property ID and returns 404 for an unknown valid ID', async () => {
    const app = createTestApp();

    expect((await app.inject({ method: 'GET', url: '/properties/not-a-uuid/pricing-preview' })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/properties/10000000-0000-4000-8000-000000000099/pricing-preview',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('uses the occupancy-only fallback when an existing property has no signals', async () => {
    const response = await createTestApp({ listMarketSignals: async () => [] }).inject({
      method: 'GET',
      url: `/properties/${property.id}/pricing-preview`,
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(ruleBasedPricingResultSchema.parse(body)).toEqual(body);
    expect(body.signal_count).toBe(0);
    expect(body.market_signals_used).toBe(false);
  });

  it('returns a safe 503 when loading the property fails', async () => {
    const response = await createTestApp({
      findPropertyById: async () => {
        throw new Error('postgresql://username:secret@host/database');
      },
    }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-preview` });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });

  it('returns a safe 503 when loading signals fails', async () => {
    const response = await createTestApp({
      listMarketSignals: async () => {
        throw new Error('postgresql://username:secret@host/database');
      },
    }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-preview` });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });

  it('returns a safe 503 when repository data cannot produce a valid pricing result', async () => {
    const response = await createTestApp({
      listMarketSignals: async () => [
        { ...signals[0], property_id: '10000000-0000-4000-8000-000000000099' },
      ],
    }).inject({ method: 'GET', url: `/properties/${property.id}/pricing-preview` });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable.' });
  });

  it('only uses repository read methods', async () => {
    const findPropertyById = vi.fn(repository.findPropertyById);
    const listMarketSignals = vi.fn(repository.listMarketSignals);
    const writePricingRecommendation = vi.fn();
    const repositoryWithWriteSpy = {
      findPropertyById,
      listMarketSignals,
      writePricingRecommendation,
    };
    const response = await createTestApp(repositoryWithWriteSpy).inject({
      method: 'GET',
      url: `/properties/${property.id}/pricing-preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(findPropertyById).toHaveBeenCalledWith(property.id);
    expect(listMarketSignals).toHaveBeenCalledWith(property.id);
    expect(writePricingRecommendation).not.toHaveBeenCalled();
  });
});

describe('AI pricing preview route', () => {
  it('calculates deterministic pricing once and returns the complete schema-valid preview for a valid recommendation', async () => {
    const pricingCalculator = vi.fn(calculateRuleBasedPricing);
    const aiPricingProvider: AiPricingProvider = {
      getRecommendation: async (ruleBasedPricing) => ({
        recommended_price: ruleBasedPricing.recommended_price,
        explanation: 'The deterministic result is authoritative.',
        confidence_score: 0.8,
        risk_level: 'low',
      }),
    };
    const response = await createTestApp({}, { aiPricingProvider, calculateRuleBasedPricing: pricingCalculator }).inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });
    const body = response.json();
    const expectedPricing = calculateRuleBasedPricing(property, signals);

    expect(response.statusCode).toBe(200);
    expect(aiPricingPreviewResponseSchema.parse(body)).toEqual(body);
    expect(body.rule_based_pricing).toEqual(expectedPricing);
    expect(body.ai_recommendation).toEqual({
      recommended_price: expectedPricing.recommended_price,
      explanation: 'The deterministic result is authoritative.',
      confidence_score: 0.8,
      risk_level: 'low',
    });
    expect(pricingCalculator).toHaveBeenCalledTimes(1);
    expect(pricingCalculator).toHaveBeenCalledWith(property, signals);
  });

  it('returns stable stub-backed output without an API key or network access', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const app = createTestApp({}, { aiPricingProvider: stubAiPricingProvider });

    const first = await app.inject({ method: 'GET', url: `/properties/${property.id}/ai-pricing-preview` });
    const second = await app.inject({ method: 'GET', url: `/properties/${property.id}/ai-pricing-preview` });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid property ID and 404 for an unknown valid ID', async () => {
    const app = createTestApp();

    expect((await app.inject({ method: 'GET', url: '/properties/not-a-uuid/ai-pricing-preview' })).statusCode).toBe(400);
    expect(
      (await app.inject({
        method: 'GET',
        url: '/properties/10000000-0000-4000-8000-000000000099/ai-pricing-preview',
      })).statusCode,
    ).toBe(404);
  });

  it('safely rejects runtime-invalid injected provider output with validation issue codes', async () => {
    const app = createTestApp(
      {},
      {
        aiPricingProvider: {
          getRecommendation: async () => ({
            recommended_price: '104.34',
            explanation: 'provider payload secret',
            confidence_score: 0.8,
            risk_level: 'low',
          }),
        } as unknown as AiPricingProvider,
      },
    );
    const response = await app.inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });

    expect(response.statusCode).toBe(422);
    expect(aiPricingValidationRejectionResponseSchema.parse(response.json())).toEqual({
      error: 'Recommendation rejected.',
      issue_codes: ['malformed_recommendation'],
    });
    expect(response.body).not.toContain('provider payload secret');
  });

  it('safely rejects a schema-valid provider price that differs from the authoritative result', async () => {
    const app = createTestApp(
      {},
      {
        aiPricingProvider: {
          getRecommendation: async (ruleBasedPricing) => ({
            recommended_price: ruleBasedPricing.recommended_price + 0.01,
            explanation: 'A schema-valid but non-authoritative price.',
            confidence_score: 0.8,
            risk_level: 'low',
          }),
        },
      },
    );
    const response = await app.inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });

    expect(response.statusCode).toBe(422);
    expect(aiPricingValidationRejectionResponseSchema.parse(response.json())).toEqual({
      error: 'Recommendation rejected.',
      issue_codes: ['price_mismatch_authoritative_result'],
    });
  });

  it('safely rejects an authoritative deterministic result above the 30% policy limit', async () => {
    const policyConflictPricing = ruleBasedPricingResultSchema.parse({
      ...calculateRuleBasedPricing(property, signals),
      minimum_recommended_price: 237.5,
      recommended_price: 240.51,
      maximum_recommended_price: 243.5,
      adjustments: {
        occupancy: 0.2,
        demand: 0.1,
        competitor: 0.1,
        seasonality: 0.05,
        local_event: 0.05,
        total: 0.35,
      },
    });
    const pricingCalculator = vi.fn(() => policyConflictPricing);
    const app = createTestApp(
      {},
      {
        calculateRuleBasedPricing: pricingCalculator,
        aiPricingProvider: {
          getRecommendation: async (ruleBasedPricing) => ({
            recommended_price: ruleBasedPricing.recommended_price,
            explanation: 'The deterministic result is authoritative.',
            confidence_score: 0.8,
            risk_level: 'low',
          }),
        },
      },
    );
    const response = await app.inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });

    expect(response.statusCode).toBe(422);
    expect(aiPricingValidationRejectionResponseSchema.parse(response.json())).toEqual({
      error: 'Recommendation rejected.',
      issue_codes: ['authoritative_result_exceeds_30_percent'],
    });
    expect(pricingCalculator).toHaveBeenCalledTimes(1);
    expect(pricingCalculator).toHaveBeenCalledWith(property, signals);
    expect(policyConflictPricing.recommended_price).toBe(240.51);
  });

  it.each([
    [
      'property repository failure',
      { findPropertyById: async () => Promise.reject(new Error('postgresql://user:secret@host/database')) },
      {},
    ],
    [
      'market-signal repository failure',
      { listMarketSignals: async () => Promise.reject(new Error('postgresql://user:secret@host/database')) },
      {},
    ],
    [
      'deterministic calculation failure',
      {},
      { calculateRuleBasedPricing: () => { throw new Error('calculation secret'); } },
    ],
    [
      'provider call failure',
      {},
      { aiPricingProvider: { getRecommendation: async () => Promise.reject(new Error('provider payload secret')) } },
    ],
  ])('returns a safe 503 for %s', async (_failure, repositoryOverrides, dependencyOverrides) => {
    const response = await createTestApp(repositoryOverrides, dependencyOverrides).inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'Service unavailable.' });
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('postgresql');
  });

  it('contains invalid OpenAI configuration to the AI preview route', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', '');
    const app = createApp({
      logger: false,
      checkDatabaseConnection: async () => undefined,
      closeDatabase: async () => undefined,
      rentalDataRepository: repository,
    });
    apps.push(app);

    const aiPreview = await app.inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });
    const deterministicPreview = await app.inject({
      method: 'GET',
      url: `/properties/${property.id}/pricing-preview`,
    });

    expect(aiPreview.statusCode).toBe(503);
    expect(aiPreview.json()).toEqual({ error: 'Service unavailable.' });
    expect(aiPreview.body).not.toContain('OPENAI_API_KEY');
    expect(deterministicPreview.statusCode).toBe(200);
    expect(ruleBasedPricingResultSchema.parse(deterministicPreview.json())).toEqual(deterministicPreview.json());
  });

  it('only invokes repository reads and never a write capability', async () => {
    const findPropertyById = vi.fn(repository.findPropertyById);
    const listMarketSignals = vi.fn(repository.listMarketSignals);
    const writePricingRecommendation = vi.fn();
    const response = await createTestApp({ findPropertyById, listMarketSignals, writePricingRecommendation }).inject({
      method: 'GET',
      url: `/properties/${property.id}/ai-pricing-preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(findPropertyById).toHaveBeenCalledWith(property.id);
    expect(listMarketSignals).toHaveBeenCalledWith(property.id);
    expect(writePricingRecommendation).not.toHaveBeenCalled();
  });
});
