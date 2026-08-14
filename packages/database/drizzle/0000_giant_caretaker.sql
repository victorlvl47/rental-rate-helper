CREATE TYPE "public"."rental_market" AS ENUM('New York', 'Las Vegas', 'Guatemala City', 'Toronto');--> statement-breakpoint
CREATE TABLE "market_signals" (
	"property_id" uuid NOT NULL,
	"date" date NOT NULL,
	"competitor_avg_price" numeric(10, 2) NOT NULL,
	"local_event_score" numeric NOT NULL,
	"seasonality_score" numeric NOT NULL,
	"demand_score" numeric NOT NULL,
	CONSTRAINT "market_signals_property_id_date_unique" UNIQUE("property_id","date"),
	CONSTRAINT "market_signals_competitor_avg_price_nonnegative" CHECK ("market_signals"."competitor_avg_price" >= 0),
	CONSTRAINT "market_signals_local_event_score_range" CHECK ("market_signals"."local_event_score" BETWEEN 0 AND 1),
	CONSTRAINT "market_signals_seasonality_score_range" CHECK ("market_signals"."seasonality_score" BETWEEN 0 AND 1),
	CONSTRAINT "market_signals_demand_score_range" CHECK ("market_signals"."demand_score" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"city" "rental_market" NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"min_price" numeric(10, 2) NOT NULL,
	"max_price" numeric(10, 2) NOT NULL,
	"bedrooms" integer NOT NULL,
	"bathrooms" numeric NOT NULL,
	"max_guests" integer NOT NULL,
	"current_occupancy_rate" numeric NOT NULL,
	"target_occupancy_rate" numeric NOT NULL,
	CONSTRAINT "properties_base_price_nonnegative" CHECK ("properties"."base_price" >= 0),
	CONSTRAINT "properties_min_price_nonnegative" CHECK ("properties"."min_price" >= 0),
	CONSTRAINT "properties_max_price_nonnegative" CHECK ("properties"."max_price" >= 0),
	CONSTRAINT "properties_bedrooms_nonnegative" CHECK ("properties"."bedrooms" >= 0),
	CONSTRAINT "properties_bathrooms_nonnegative" CHECK ("properties"."bathrooms" >= 0),
	CONSTRAINT "properties_max_guests_positive" CHECK ("properties"."max_guests" >= 1),
	CONSTRAINT "properties_current_occupancy_rate_range" CHECK ("properties"."current_occupancy_rate" BETWEEN 0 AND 1),
	CONSTRAINT "properties_target_occupancy_rate_range" CHECK ("properties"."target_occupancy_rate" BETWEEN 0 AND 1),
	CONSTRAINT "properties_min_price_lte_base_price" CHECK ("properties"."min_price" <= "properties"."base_price"),
	CONSTRAINT "properties_base_price_lte_max_price" CHECK ("properties"."base_price" <= "properties"."max_price")
);
--> statement-breakpoint
ALTER TABLE "market_signals" ADD CONSTRAINT "market_signals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "properties_city_idx" ON "properties" USING btree ("city");