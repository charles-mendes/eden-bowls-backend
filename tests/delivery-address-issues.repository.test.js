const { DeliveryAddressIssuesRepository } = require('../src/infrastructure/repositories/delivery-address-issues.repository');

const squash = (sql) => sql.replace(/\s+/g, ' ');

// close-address-issues-when-subscription-ends
describe('DeliveryAddressIssuesRepository.closeEnded', () => {
  const now = new Date('2026-11-11T12:00:00Z');

  test('closes open problems of canceled subscriptions with no paid box left, for one subscription', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const repository = new DeliveryAddressIssuesRepository({ query });

    await expect(repository.closeEnded({ subscriptionId: '179', now })).resolves.toBe(1);

    const [sql, params] = query.mock.calls[0];
    const flat = squash(sql);
    expect(flat).toContain('UPDATE `delivery_address_issues` i JOIN `stripe_subscriptions` s ON s.id = i.subscription_id');
    expect(flat).toContain("i.`resolved_by` = 'ended'");
    expect(flat).toContain("s.`status` = 'canceled'");
    expect(flat).not.toContain('incomplete_expired');
    expect(flat).toContain('c.paid_at IS NOT NULL AND c.paid_invoice_id IS NOT NULL');
    expect(flat).toContain("cd.status IN ('out_for_delivery', 'delivered')");
    expect(flat).toContain("us.status IN ('created', 'delivered')");
    expect(flat).toContain('cd.stripe_invoice_id COLLATE utf8mb4_unicode_ci = c.paid_invoice_id COLLATE utf8mb4_unicode_ci');
    expect(flat).toContain('i.`subscription_id` = ?');
    expect(params).toEqual(['2026-11-11 12:00:00', 179]);
  });

  test('without a subscription it closes every problem that meets the rule', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 3 });
    const repository = new DeliveryAddressIssuesRepository({ query }, {
      ledgerTableName: 'ledger', productionCyclesTableName: 'cycles', courierTableName: 'courier', upsTableName: 'ups'
    });

    await expect(repository.closeEnded({ now })).resolves.toBe(3);

    const [sql, params] = query.mock.calls[0];
    const flat = squash(sql);
    expect(flat).not.toContain('i.`subscription_id` = ?');
    expect(flat).toContain('JOIN `ledger` s');
    expect(flat).toContain('FROM `cycles` c');
    expect(flat).toContain('FROM `courier` cd');
    expect(flat).toContain('FROM `ups` us');
    expect(params).toEqual(['2026-11-11 12:00:00']);
  });

  test('an invalid subscription id closes nothing and runs no query', async () => {
    const query = jest.fn();
    await expect(new DeliveryAddressIssuesRepository({ query }).closeEnded({ subscriptionId: 'sub_x', now })).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
