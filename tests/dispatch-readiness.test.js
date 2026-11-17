const { invoiceReadinessReasons, readinessReasons } = require('../src/core/dispatch-readiness');

describe('dispatch readiness', () => {
  test('a ready cycle of an active or trialing subscription has no reason', () => {
    expect(readinessReasons({ productionStatus: 'ready', subscriptionStatus: 'active' })).toEqual([]);
    expect(readinessReasons({ productionStatus: 'ready', subscriptionStatus: 'trialing' })).toEqual([]);
  });

  test('names production and subscription problems', () => {
    expect(readinessReasons({ productionStatus: 'in_production', subscriptionStatus: 'past_due' })).toEqual([
      { code: 'production_not_ready', production_status: 'in_production' },
      { code: 'subscription_not_active', subscription_status: 'past_due' }
    ]);
  });

  test('an invoice with no paid cycle is not ready', async () => {
    const ledgerRepository = { listPaidCyclesByInvoiceIds: jest.fn().mockResolvedValue([]) };
    await expect(invoiceReadinessReasons(ledgerRepository, { status: 'active' }, 'in_1')).resolves.toEqual([
      { code: 'production_not_ready', production_status: null }
    ]);
    expect(ledgerRepository.listPaidCyclesByInvoiceIds).toHaveBeenCalledWith(['in_1']);
  });
});
