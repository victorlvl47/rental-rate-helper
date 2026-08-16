import { afterEach, describe, expect, it } from 'vitest';
import { marketSignalSchema, propertySchema, RENTAL_MARKETS, type MarketSignal, type Property } from 'shared';
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
