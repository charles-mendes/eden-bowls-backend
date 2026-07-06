import { ConflictException, NotFoundException } from '@nestjs/common';

import { ShippingService } from './shipping.service';

type PrismaMock = {
  shippingQuote: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  shippingQuoteRate: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  shippingQuote: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  shippingQuoteRate: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('ShippingService', () => {
  let prisma: PrismaMock;
  let service: ShippingService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ShippingService(prisma as never);
  });

  it('createQuote should create quote with generated rates', async () => {
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      prisma.shippingQuote.create.mockResolvedValue({ id: 'quote_1', expiresAt: new Date('2026-07-06T12:00:00.000Z') });
      prisma.shippingQuoteRate.create.mockResolvedValueOnce({
        id: 'rate_1',
        serviceCode: 'manual_local_standard',
        serviceLabel: 'Entrega local padrao',
        amount: { toNumber: () => 19.9 },
        etaMinDays: 1,
        etaMaxDays: 2,
      });
      prisma.shippingQuoteRate.create.mockResolvedValueOnce({
        id: 'rate_2',
        serviceCode: 'manual_local_express',
        serviceLabel: 'Entrega local expressa',
        amount: { toNumber: () => 34.9 },
        etaMinDays: 0,
        etaMaxDays: 1,
      });
      return callback(prisma as never);
    });

    const output = await service.createQuote('session_1', {
      destination: { country: 'BR', postcode: '01000-000' },
      items: [{ quantity: 2, unitPrice: 50 }],
    });

    expect(output.quoteId).toBe('quote_1');
    expect(output.rates).toHaveLength(2);
    expect(prisma.shippingQuote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: 'session_1',
          destinationCountry: 'BR',
          currency: 'BRL',
        }),
      }),
    );
  });

  it('selectRate should throw when quote is missing', async () => {
    prisma.shippingQuote.findFirst.mockResolvedValue(null);

    await expect(
      service.selectRate('session_1', {
        quoteId: '11111111-1111-1111-1111-111111111111',
        rateId: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('selectRate should throw when quote expired', async () => {
    prisma.shippingQuote.findFirst.mockResolvedValue({
      id: 'quote_1',
      sessionId: 'session_1',
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      provider: 'manual_local',
      currency: 'BRL',
      rates: [{ id: 'rate_1' }],
    });

    await expect(
      service.selectRate('session_1', {
        quoteId: '11111111-1111-1111-1111-111111111111',
        rateId: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
