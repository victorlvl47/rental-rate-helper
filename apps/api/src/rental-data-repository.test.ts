import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  asc: vi.fn((column: unknown) => ({ column, direction: 'asc' })),
  eq: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  marketSignals: {
    property_id: 'market_signals.property_id',
    date: 'market_signals.date',
  },
}));

vi.mock('drizzle-orm', () => ({ asc: mocks.asc, eq: mocks.eq }));

vi.mock('database', () => ({
  db: { select: mocks.select },
  properties: {},
  marketSignals: mocks.marketSignals,
}));

import { createRentalDataRepository } from './rental-data-repository.js';

describe('rental data repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
    mocks.orderBy.mockResolvedValue([
      {
        property_id: '10000000-0000-4000-8000-000000000001',
        date: '2026-09-14',
        competitor_avg_price: '175.00',
        local_event_score: '0.65',
        seasonality_score: '0.72',
        demand_score: '0.76',
      },
    ]);
  });

  it('requests market signals ordered by ascending date', async () => {
    const repository = createRentalDataRepository();

    await repository.listMarketSignals('10000000-0000-4000-8000-000000000001');

    expect(mocks.asc).toHaveBeenCalledWith(mocks.marketSignals.date);
    expect(mocks.orderBy).toHaveBeenCalledWith({
      column: mocks.marketSignals.date,
      direction: 'asc',
    });
  });
});
