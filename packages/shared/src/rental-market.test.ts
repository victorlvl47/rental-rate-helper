import { describe, expect, it } from 'vitest';
import {
  marketSignalSchema,
  MVP_CURRENCY,
  propertySchema,
  RENTAL_MARKETS,
  rentalMarketSchema,
  usdAmountSchema,
} from './index.js';

const property = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'Downtown Loft',
  city: 'New York',
  base_price: 100.5,
  min_price: 80,
  max_price: 150.25,
  bedrooms: 1,
  bathrooms: 1.5,
  max_guests: 2,
  current_occupancy_rate: 0.75,
  target_occupancy_rate: 0.8,
};

const marketSignal = {
  property_id: property.id,
  date: '2028-02-29',
  competitor_avg_price: 120.5,
  local_event_score: 0.25,
  seasonality_score: 0.5,
  demand_score: 1,
};

describe('rental market contracts', () => {
  it('accepts only the four predefined markets', () => {
    expect(RENTAL_MARKETS).toEqual(['New York', 'Las Vegas', 'Guatemala City', 'Toronto']);
    expect(rentalMarketSchema.safeParse('Toronto').success).toBe(true);
    expect(rentalMarketSchema.safeParse('Miami').success).toBe(false);
  });

  it('exports the implicit MVP currency', () => {
    expect(MVP_CURRENCY).toBe('USD');
  });

  it('accepts complete snake_case property and market-signal records', () => {
    expect(propertySchema.safeParse(property).success).toBe(true);
    expect(marketSignalSchema.safeParse(marketSignal).success).toBe(true);
    expect(Object.keys(propertySchema.parse(property))).toEqual([
      'id',
      'name',
      'city',
      'base_price',
      'min_price',
      'max_price',
      'bedrooms',
      'bathrooms',
      'max_guests',
      'current_occupancy_rate',
      'target_occupancy_rate',
    ]);
    expect(Object.keys(marketSignalSchema.parse(marketSignal))).toEqual([
      'property_id',
      'date',
      'competitor_avg_price',
      'local_event_score',
      'seasonality_score',
      'demand_score',
    ]);
  });

  it('requires valid UUIDs and a non-blank property name', () => {
    expect(propertySchema.safeParse({ ...property, id: 'not-a-uuid' }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, property_id: 'not-a-uuid' }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, name: '' }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, name: '   ' }).success).toBe(false);
  });

  it('validates property counts and occupancy boundaries', () => {
    expect(propertySchema.safeParse({ ...property, bedrooms: 0 }).success).toBe(true);
    expect(propertySchema.safeParse({ ...property, bedrooms: -1 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, bedrooms: 1.5 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, bathrooms: 2 }).success).toBe(true);
    expect(propertySchema.safeParse({ ...property, bathrooms: 1.5 }).success).toBe(true);
    expect(propertySchema.safeParse({ ...property, bathrooms: -0.5 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, max_guests: 0 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, max_guests: 1.5 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, current_occupancy_rate: 0, target_occupancy_rate: 1 }).success).toBe(true);
    expect(propertySchema.safeParse({ ...property, current_occupancy_rate: -0.01 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, target_occupancy_rate: 1.01 }).success).toBe(false);
  });

  it('validates money as finite JSON numbers with two decimal places', () => {
    for (const amount of [0, 100, 100.5, 100.01, 99_999_999.99]) {
      expect(usdAmountSchema.safeParse(amount).success).toBe(true);
    }

    for (const amount of [-1, 100.999, 100_000_000, '100.50', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(usdAmountSchema.safeParse(amount).success).toBe(false);
    }
  });

  it('enforces valid property price ordering', () => {
    expect(propertySchema.safeParse({ ...property, min_price: 101 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, max_price: 99 }).success).toBe(false);
  });

  it('validates score boundaries and calendar dates without timezone conversion', () => {
    expect(marketSignalSchema.safeParse({ ...marketSignal, local_event_score: 0, seasonality_score: 1 }).success).toBe(true);
    expect(marketSignalSchema.safeParse({ ...marketSignal, demand_score: -0.01 }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, demand_score: 1.01 }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2026-02-28' }).success).toBe(true);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2028-02-29' }).success).toBe(true);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2026-02-29' }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2026-02-30' }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2026-2-28' }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, date: '2026-02-28T00:00:00Z' }).success).toBe(false);
  });

  it('rejects extra camelCase or currency fields', () => {
    expect(propertySchema.safeParse({ ...property, basePrice: 100 }).success).toBe(false);
    expect(propertySchema.safeParse({ ...property, currency: 'USD' }).success).toBe(false);
    expect(marketSignalSchema.safeParse({ ...marketSignal, currency: 'USD' }).success).toBe(false);
  });
});
