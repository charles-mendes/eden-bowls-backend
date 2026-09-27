const fs = require('fs');
const path = require('path');
const { AdminBillingService } = require('../src/services/admin-billing.service');
const {
  JOB_INTERVALS,
  RECONCILE_PAGE_SIZE,
  runLedgerReconcile
} = require('../src/services/background-jobs.service');

function row(id) {
  return {
    id,
    userId: 7,
    customerEmail: 'ana@example.com',
    stripeSubscriptionId: `sub_${id}`,
    stripeCustomerId: 'cus_1',
    stripeAccount: 'us'
  };
}

describe('ledger reconcile job', () => {
  test('pages 50 rows, advances past a failed retrieve, and wraps at the end', async () => {
    const firstPage = Array.from({ length: RECONCILE_PAGE_SIZE }, (_item, index) => row(index + 1));
    const listAfterId = jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([row(51)])
      .mockResolvedValueOnce([row(1)]);
    const hasIdAfter = jest.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const cursor = { value: '0' };
    const cursorRepository = {
      get: jest.fn(async () => cursor.value),
      set: jest.fn(async (_name, value) => {
        cursor.value = String(value);
      })
    };
    const retrieve = jest.fn(async (id) => {
      if (id === 'sub_1') {
        throw new Error('stripe down');
      }
      return {
        id,
        customer: 'cus_1',
        status: 'active',
        current_period_start: 10,
        current_period_end: 20,
        cancel_at_period_end: false
      };
    });
    const stripe = {
      subscriptions: { retrieve, update: jest.fn() },
      invoices: { create: jest.fn() },
      subscriptionSchedules: { update: jest.fn() }
    };
    const upsert = jest.fn().mockResolvedValue({});
    const productionRepository = { upsert: jest.fn(), updateStatus: jest.fn() };
    const deps = {
      cursorRepository,
      ledgerRepository: { listAfterId, hasIdAfter, upsert },
      stripeBilling: { ensureClient: () => stripe },
      productionRepository
    };

    const first = await runLedgerReconcile(deps);
    expect(first.failed).toBe(1);
    expect(first.updated).toBe(49);
    expect(cursor.value).toBe('50');
    expect(listAfterId).toHaveBeenNthCalledWith(1, 0, 50);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'active',
      currentPeriodStart: 10,
      currentPeriodEnd: 20,
      cancelAtPeriodEnd: false
    }));
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('planLabel');
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.invoices.create).not.toHaveBeenCalled();
    expect(stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(productionRepository.upsert).not.toHaveBeenCalled();
    expect(productionRepository.updateStatus).not.toHaveBeenCalled();

    await runLedgerReconcile(deps);
    expect(listAfterId).toHaveBeenNthCalledWith(2, 50, 50);
    expect(cursor.value).toBe('0');

    await runLedgerReconcile(deps);
    expect(listAfterId).toHaveBeenNthCalledWith(3, 0, 50);
    expect(JOB_INTERVALS.ledger_reconcile).toBe(60 * 60 * 1000);
  });

  test('leaves the admin reconcile POST capped at the first 100 rows', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/services/admin-billing.service.js'),
      'utf8'
    );
    expect(AdminBillingService.prototype.reconcile.toString()).toContain('perPage: 100');
    expect(source).toContain('perPage: 100');
    expect(source).not.toContain('perPage: 50');
  });
});
