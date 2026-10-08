const { AdminTodayService } = require('../src/services/admin-today.service');

const NOW = new Date('2026-10-07T15:00:00Z');

function row(overrides = {}) {
  return {
    id: 1,
    userId: '10',
    customerEmail: 'ana@example.com',
    stripeSubscriptionId: 'sub_1',
    stripeAccount: 'us',
    status: 'active',
    currentPeriodEnd: '2026-10-07 16:00:00',
    dueAt: '2026-10-07 16:00:00',
    paymentState: 'paid',
    productionStatus: 'ready',
    paidInvoiceId: 'in_1',
    address: { name: 'Ana', city: 'Miami', country: 'US' },
    ...overrides
  };
}

function service({ rows, shipments = [], closed = [] }) {
  const ledgerRepository = { listQueue: jest.fn().mockResolvedValue({ total: rows.length, items: rows }) };
  const upsShipmentRepository = { listByInvoiceIds: jest.fn().mockResolvedValue(shipments) };
  const calendar = { listActive: jest.fn().mockResolvedValue(closed) };
  return {
    ledgerRepository,
    upsShipmentRepository,
    service: new AdminTodayService({ ledgerRepository, upsShipmentRepository, calendar, now: () => NOW })
  };
}

describe('AdminTodayService', () => {
  test('counts today, tomorrow and overdue work per market', async () => {
    const { service: today } = service({
      rows: [
        row({ id: 1 }),
        row({ id: 2, stripeAccount: 'br', paidInvoiceId: null, address: { city: 'Curitiba', country: 'BR' }, dueAt: '2026-10-08 15:00:00' }),
        row({ id: 3, dueAt: '2026-10-05 15:00:00' })
      ]
    });

    const result = await today.overview({ timezone: 'America/Sao_Paulo' });

    expect(result.data.today).toBe('2026-10-07');
    expect(result.data.totals).toEqual({ overdue: 1, today: 1, tomorrow: 1 });
    expect(result.data.byMarket.BR).toEqual({ overdue: 0, today: 0, tomorrow: 1 });
    expect(result.data.byMarket.US).toEqual({ overdue: 1, today: 1, tomorrow: 0 });
  });

  test('asks the queue for the overdue month and the next two civil days', async () => {
    const { service: today, ledgerRepository } = service({ rows: [] });

    await today.overview({ timezone: 'America/Sao_Paulo' });

    expect(ledgerRepository.listQueue).toHaveBeenCalledWith(expect.objectContaining({
      startOfToday: '2026-10-07 03:00:00',
      windowEndExclusive: '2026-10-09 03:00:00',
      overdueFloor: '2026-09-07 03:00:00',
      includeOverdue: true
    }));
  });

  test('flags a paid US cycle whose invoice has no UPS label', async () => {
    const { service: today, upsShipmentRepository } = service({
      rows: [row({ id: 1, paidInvoiceId: 'in_1' }), row({ id: 2, paidInvoiceId: 'in_2' }), row({ id: 3, paymentState: 'awaiting_payment', paidInvoiceId: null })],
      shipments: [{ stripe_invoice_id: 'in_1' }]
    });

    const result = await today.overview({});

    expect(upsShipmentRepository.listByInvoiceIds).toHaveBeenCalledWith(['in_1', 'in_2']);
    expect(result.data.items.map((item) => [item.id, item.upsLabel])).toEqual([[1, 'created'], [2, 'missing'], [3, null]]);
    expect(result.data.items[0]).not.toHaveProperty('paidInvoiceId');
  });

  test('lists closed days of today and tomorrow for the markets in scope', async () => {
    const { service: today } = service({
      rows: [],
      closed: [
        { market: 'BR', closedOn: '2026-10-12', label: 'Nossa Senhora Aparecida', closesDelivery: true },
        { market: 'BR', closedOn: '2026-10-08', label: 'Folga', closesPreparation: true, closesDelivery: true },
        { market: 'US', closedOn: '2026-10-07', label: 'Company day', closesDelivery: true }
      ]
    });

    const result = await today.overview({}, { roles: ['operator'], markets: ['BR'] });

    expect(result.data.closedDays).toEqual([
      expect.objectContaining({ market: 'BR', date: '2026-10-08', label: 'Folga' })
    ]);
  });
});
