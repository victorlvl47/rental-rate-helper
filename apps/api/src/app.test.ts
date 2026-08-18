import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  marketSignalSchema,
  propertySchema,
  RENTAL_MARKETS,
  ruleBasedPricingResultSchema,
  type MarketSignal,
  type Property,
} from 'shared';
import { createApp } from './app.js';
import type { RentalDataRepository } from './rental-data-repository.js';

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

function createTestApp(overrides: Partial<RentalDataRepository> = {}) {
  const app = createApp({
    logger: false,
    checkDatabaseConnection: async () => undefined,
    closeDatabase: async () => undefined,
    rentalDataRepository: { ...repository, ...overrides },
  });

  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
