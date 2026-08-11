import { z } from 'zod';

export const RENTAL_MARKETS = [
  'New York',
  'Las Vegas',
  'Guatemala City',
  'Toronto',
] as const;

export const rentalMarketSchema = z.enum(RENTAL_MARKETS);

export type RentalMarket = z.infer<typeof rentalMarketSchema>;

export const MVP_CURRENCY = 'USD';

const MAX_USD_AMOUNT = 99_999_999.99;
const MONEY_PRECISION_TOLERANCE = 1e-8;

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaledValue = value * 100;

  return Math.abs(scaledValue - Math.round(scaledValue)) < MONEY_PRECISION_TOLERANCE;
}

export const usdAmountSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_USD_AMOUNT)
  .refine(hasAtMostTwoDecimalPlaces, {
    message: 'USD amounts must have no more than two decimal places.',
  });

const rateSchema = z.number().finite().min(0).max(1);

const calendarDatePattern = /^\d{4}-(\d{2})-(\d{2})$/;

function isValidCalendarDate(value: string): boolean {
  const match = calendarDatePattern.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(match[1]);
  const day = Number(match[2]);

  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return day <= daysInMonth;
}

export const calendarDateSchema = z.string().refine(isValidCalendarDate, {
  message: 'Expected a valid calendar date in YYYY-MM-DD format.',
});

export const propertySchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1),
    city: rentalMarketSchema,
    base_price: usdAmountSchema,
    min_price: usdAmountSchema,
    max_price: usdAmountSchema,
    bedrooms: z.number().int().min(0),
    bathrooms: z.number().finite().min(0),
    max_guests: z.number().int().min(1),
    current_occupancy_rate: rateSchema,
    target_occupancy_rate: rateSchema,
  })
  .strict()
  .superRefine((property, context) => {
    if (property.min_price > property.base_price) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'min_price must be less than or equal to base_price.',
        path: ['min_price'],
      });
    }

    if (property.base_price > property.max_price) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'base_price must be less than or equal to max_price.',
        path: ['base_price'],
      });
    }
  });

export type Property = z.infer<typeof propertySchema>;

export const marketSignalSchema = z
  .object({
    property_id: z.uuid(),
    date: calendarDateSchema,
    competitor_avg_price: usdAmountSchema,
    local_event_score: rateSchema,
    seasonality_score: rateSchema,
    demand_score: rateSchema,
  })
  .strict();

export type MarketSignal = z.infer<typeof marketSignalSchema>;
