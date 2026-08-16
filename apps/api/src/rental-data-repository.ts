import { asc, eq } from 'drizzle-orm';
import { db, marketSignals, properties } from 'database';
import {
  marketSignalSchema,
  propertySchema,
  type MarketSignal,
  type Property,
  type RentalMarket,
} from 'shared';

export interface RentalDataRepository {
  listProperties(city: RentalMarket): Promise<Property[]>;
  findPropertyById(propertyId: string): Promise<Property | undefined>;
  listMarketSignals(propertyId: string): Promise<MarketSignal[]>;
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

function propertyFromDatabase(property: typeof properties.$inferSelect): Property {
  return propertySchema.parse({
    ...property,
    base_price: toNumber(property.base_price),
    min_price: toNumber(property.min_price),
    max_price: toNumber(property.max_price),
    bathrooms: toNumber(property.bathrooms),
    current_occupancy_rate: toNumber(property.current_occupancy_rate),
    target_occupancy_rate: toNumber(property.target_occupancy_rate),
  });
}

function marketSignalFromDatabase(signal: typeof marketSignals.$inferSelect): MarketSignal {
  return marketSignalSchema.parse({
    ...signal,
    competitor_avg_price: toNumber(signal.competitor_avg_price),
    local_event_score: toNumber(signal.local_event_score),
    seasonality_score: toNumber(signal.seasonality_score),
    demand_score: toNumber(signal.demand_score),
  });
}

export function createRentalDataRepository(): RentalDataRepository {
  return {
    async listProperties(city) {
      const rows = await db.select().from(properties).where(eq(properties.city, city));

      return rows.map(propertyFromDatabase);
    },

    async findPropertyById(propertyId) {
      const [property] = await db
        .select()
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      return property === undefined ? undefined : propertyFromDatabase(property);
    },

    async listMarketSignals(propertyId) {
      const rows = await db
        .select()
        .from(marketSignals)
        .where(eq(marketSignals.property_id, propertyId))
        .orderBy(asc(marketSignals.date));

      return rows.map(marketSignalFromDatabase);
    },
  };
}
