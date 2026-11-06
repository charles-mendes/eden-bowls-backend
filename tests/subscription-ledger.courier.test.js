const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

const paidRow = { id: 42, stripe_subscription_id: 'sub_br_1', stripe_account: 'br', status: 'active', payment_state: 'paid', paid_invoice_id: 'in_1', production_status: 'ready', delivery_date: '2026-11-05', address: '{"country":"BR"}' };

describe('SubscriptionLedgerRepository courier queries', () => {
  test('listPaidCourierCycles filters Brazil by the address, not the Stripe account, with the date floor', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const rows = await repository.listPaidCourierCycles({ deliveryFloor: '2026-10-05', limit: 201 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPPER(JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.country'))) = 'BR'");
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL");
    expect(sql).not.toContain("q.stripe_account = ");
    expect(sql).toContain('COALESCE(q.delivery_date, DATE(q.cycle_period_end)) >= ?');
    expect(params).toEqual(['2026-10-05', 201]);
    expect(rows[0]).toMatchObject({ paidInvoiceId: 'in_1', productionStatus: 'ready', deliveryDate: '2026-11-05' });
  });

  test('listPaidCyclesByInvoiceIds has no floor and skips an empty list', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.listPaidCyclesByInvoiceIds([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
    await repository.listPaidCyclesByInvoiceIds(['in_1', 'in_1', 'in_2']);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IN (?, ?)");
    expect(sql).not.toContain('>= ?');
    expect(params).toEqual(['in_1', 'in_2']);
  });

  test('listPaidCyclesBySubscription lists one subscription, newest delivery first, with null dates in place', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.listPaidCyclesBySubscription('abc')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
    const rows = await repository.listPaidCyclesBySubscription('42');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL AND q.id = ?");
    expect(sql).toContain('ORDER BY COALESCE(q.delivery_date, DATE(q.cycle_period_end)) DESC');
    expect(params).toEqual([42, 24]);
    expect(rows[0]).toMatchObject({ paidInvoiceId: 'in_1' });
  });
});
