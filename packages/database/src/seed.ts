import { marketSignalSchema, propertySchema, type MarketSignal, type Property } from 'shared';
import { closeDatabase, db } from './client.js';
import { marketSignals, properties } from './schema/index.js';

const seedProperties = [
  {
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
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Sample Parkside Townhouse',
    city: 'New York',
    base_price: 360,
    min_price: 270,
    max_price: 480,
    bedrooms: 3,
    bathrooms: 2.5,
    max_guests: 6,
    current_occupancy_rate: 0.84,
    target_occupancy_rate: 0.82,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    name: 'Sample Neon Desert Suite',
    city: 'Las Vegas',
    base_price: 145,
    min_price: 95,
    max_price: 235,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 3,
    current_occupancy_rate: 0.66,
    target_occupancy_rate: 0.74,
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    name: 'Sample Red Rock Retreat',
    city: 'Las Vegas',
    base_price: 285,
    min_price: 210,
    max_price: 410,
    bedrooms: 4,
    bathrooms: 3.5,
    max_guests: 10,
    current_occupancy_rate: 0.58,
    target_occupancy_rate: 0.7,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    name: 'Sample Jacaranda Loft',
    city: 'Guatemala City',
    base_price: 78,
    min_price: 55,
    max_price: 115,
    bedrooms: 1,
    bathrooms: 1,
    max_guests: 2,
    current_occupancy_rate: 0.63,
    target_occupancy_rate: 0.7,
  },
  {
    id: '10000000-0000-4000-8000-000000000006',
    name: 'Sample Vista Family Home',
    city: 'Guatemala City',
    base_price: 132,
    min_price: 95,
    max_price: 185,
    bedrooms: 3,
    bathrooms: 2.5,
    max_guests: 7,
    current_occupancy_rate: 0.76,
    target_occupancy_rate: 0.75,
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    name: 'Sample Lakeside Micro Loft',
    city: 'Toronto',
    base_price: 155,
    min_price: 115,
    max_price: 220,
    bedrooms: 0,
    bathrooms: 1,
    max_guests: 2,
    current_occupancy_rate: 0.69,
    target_occupancy_rate: 0.76,
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    name: 'Sample Maple Family Flat',
    city: 'Toronto',
    base_price: 245,
    min_price: 185,
    max_price: 335,
    bedrooms: 2,
    bathrooms: 1.5,
    max_guests: 5,
    current_occupancy_rate: 0.81,
    target_occupancy_rate: 0.8,
  },
] satisfies readonly Property[];

const signalDates = ['2026-09-14', '2026-10-18'] as const;

const signalValues = [
  [175, 0.65, 0.72, 0.76],
  [225, 0.9, 0.81, 0.88],
  [132, 0.55, 0.68, 0.63],
  [198, 0.85, 0.77, 0.8],
  [72, 0.4, 0.62, 0.58],
  [102, 0.68, 0.74, 0.71],
  [310, 0.7, 0.73, 0.75],
  [390, 0.92, 0.86, 0.9],
  [70, 0.35, 0.6, 0.57],
  [92, 0.58, 0.7, 0.66],
  [118, 0.52, 0.64, 0.69],
  [155, 0.76, 0.78, 0.81],
  [142, 0.45, 0.67, 0.64],
  [188, 0.7, 0.79, 0.74],
  [228, 0.5, 0.7, 0.73],
  [290, 0.82, 0.83, 0.85],
] as const;

const seedMarketSignals = seedProperties.flatMap((property, propertyIndex) =>
  signalDates.map((date, dateIndex) => {
    const [competitor_avg_price, local_event_score, seasonality_score, demand_score] =
      signalValues[propertyIndex * signalDates.length + dateIndex];

    return {
      property_id: property.id,
      date,
      competitor_avg_price,
      local_event_score,
      seasonality_score,
      demand_score,
    };
  }),
) satisfies readonly MarketSignal[];

function propertyForDatabase(property: Property) {
  return {
    ...property,
    base_price: property.base_price.toFixed(2),
    min_price: property.min_price.toFixed(2),
    max_price: property.max_price.toFixed(2),
    bathrooms: property.bathrooms.toString(),
    current_occupancy_rate: property.current_occupancy_rate.toString(),
    target_occupancy_rate: property.target_occupancy_rate.toString(),
  };
}

function marketSignalForDatabase(signal: MarketSignal) {
  return {
    ...signal,
    competitor_avg_price: signal.competitor_avg_price.toFixed(2),
    local_event_score: signal.local_event_score.toString(),
    seasonality_score: signal.seasonality_score.toString(),
    demand_score: signal.demand_score.toString(),
  };
}

async function seed(): Promise<void> {
  const validatedProperties = seedProperties.map((property) => propertySchema.parse(property));
  const validatedSignals = seedMarketSignals.map((signal) => marketSignalSchema.parse(signal));

  await db.transaction(async (transaction) => {
    for (const property of validatedProperties) {
      const values = propertyForDatabase(property);

      await transaction
        .insert(properties)
        .values(values)
        .onConflictDoUpdate({
          target: properties.id,
          set: values,
        });
    }

    for (const signal of validatedSignals) {
      const values = marketSignalForDatabase(signal);

      await transaction
        .insert(marketSignals)
        .values(values)
        .onConflictDoUpdate({
          target: [marketSignals.property_id, marketSignals.date],
          set: values,
        });
    }
  });

  console.log(`Seeded ${validatedProperties.length} fake USD properties and ${validatedSignals.length} fake market signals.`);
}

seed()
  .catch((error: unknown) => {
    console.error('Database seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
