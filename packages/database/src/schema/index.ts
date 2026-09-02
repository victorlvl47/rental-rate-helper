import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const rentalMarketEnum = pgEnum('rental_market', [
  'New York',
  'Las Vegas',
  'Guatemala City',
  'Toronto',
]);

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    city: rentalMarketEnum('city').notNull(),
    base_price: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
    min_price: numeric('min_price', { precision: 10, scale: 2 }).notNull(),
    max_price: numeric('max_price', { precision: 10, scale: 2 }).notNull(),
    bedrooms: integer('bedrooms').notNull(),
    bathrooms: numeric('bathrooms').notNull(),
    max_guests: integer('max_guests').notNull(),
    current_occupancy_rate: numeric('current_occupancy_rate').notNull(),
    target_occupancy_rate: numeric('target_occupancy_rate').notNull(),
  },
  (table) => [
    index('properties_city_idx').on(table.city),
    check('properties_base_price_nonnegative', sql`${table.base_price} >= 0`),
    check('properties_min_price_nonnegative', sql`${table.min_price} >= 0`),
    check('properties_max_price_nonnegative', sql`${table.max_price} >= 0`),
    check('properties_bedrooms_nonnegative', sql`${table.bedrooms} >= 0`),
    check('properties_bathrooms_nonnegative', sql`${table.bathrooms} >= 0`),
    check('properties_max_guests_positive', sql`${table.max_guests} >= 1`),
    check('properties_current_occupancy_rate_range', sql`${table.current_occupancy_rate} BETWEEN 0 AND 1`),
    check('properties_target_occupancy_rate_range', sql`${table.target_occupancy_rate} BETWEEN 0 AND 1`),
    check('properties_min_price_lte_base_price', sql`${table.min_price} <= ${table.base_price}`),
    check('properties_base_price_lte_max_price', sql`${table.base_price} <= ${table.max_price}`),
  ],
);

export const marketSignals = pgTable(
  'market_signals',
  {
    property_id: uuid('property_id')
      .notNull()
      .references(() => properties.id),
    date: date('date', { mode: 'string' }).notNull(),
    competitor_avg_price: numeric('competitor_avg_price', { precision: 10, scale: 2 }).notNull(),
    local_event_score: numeric('local_event_score').notNull(),
    seasonality_score: numeric('seasonality_score').notNull(),
    demand_score: numeric('demand_score').notNull(),
  },
  (table) => [
    unique('market_signals_property_id_date_unique').on(table.property_id, table.date),
    check('market_signals_competitor_avg_price_nonnegative', sql`${table.competitor_avg_price} >= 0`),
    check('market_signals_local_event_score_range', sql`${table.local_event_score} BETWEEN 0 AND 1`),
    check('market_signals_seasonality_score_range', sql`${table.seasonality_score} BETWEEN 0 AND 1`),
    check('market_signals_demand_score_range', sql`${table.demand_score} BETWEEN 0 AND 1`),
  ],
);

export const pricingWorkflowStatusEnum = pgEnum('pricing_workflow_status', ['pending', 'running', 'accepted', 'rejected', 'failed']);
export const pricingWorkflowRequests = pgTable('pricing_workflow_requests', {
  id: uuid('id').defaultRandom().primaryKey(), property_id: uuid('property_id').notNull().references(() => properties.id), pricing_date: date('pricing_date', { mode: 'string' }).notNull(), temporal_workflow_id: text('temporal_workflow_id').notNull(), status: pricingWorkflowStatusEnum('status').notNull().default('pending'), issue_codes: text('issue_codes').array().notNull().default(sql`ARRAY[]::text[]`), created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [unique('pricing_workflow_requests_property_date_unique').on(table.property_id, table.pricing_date), unique('pricing_workflow_requests_temporal_id_unique').on(table.temporal_workflow_id)]);
export const pricingRecommendations = pgTable('pricing_recommendations', {
  id: uuid('id').defaultRandom().primaryKey(), request_id: uuid('request_id').notNull().references(() => pricingWorkflowRequests.id), property_id: uuid('property_id').notNull().references(() => properties.id), pricing_date: date('pricing_date', { mode: 'string' }).notNull(), deterministic_result: jsonb('deterministic_result').$type<unknown>(), deterministic_price: numeric('deterministic_price', { precision: 10, scale: 2 }).notNull(), minimum_price: numeric('minimum_price', { precision: 10, scale: 2 }).notNull(), maximum_price: numeric('maximum_price', { precision: 10, scale: 2 }).notNull(), explanation: text('explanation').notNull(), confidence_score: numeric('confidence_score').notNull(), risk_level: text('risk_level').notNull(), validation_status: text('validation_status').notNull().default('accepted'), created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [unique('pricing_recommendations_request_unique').on(table.request_id)]);
export const aiCallMetrics = pgTable('ai_call_metrics', {
  id: uuid('id').defaultRandom().primaryKey(), request_id: uuid('request_id').notNull().references(() => pricingWorkflowRequests.id), recommendation_id: uuid('recommendation_id').references(() => pricingRecommendations.id), model: text('model').notNull(), prompt_version: text('prompt_version').notNull(), input_tokens: integer('input_tokens'), output_tokens: integer('output_tokens'), estimated_cost_usd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }), latency_ms: integer('latency_ms').notNull(), success: integer('success').notNull(), created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
