const { CloseAddressIssuesOfEndedSubscriptions1700000000072 } = require('../src/infrastructure/migrations/1700000000072-close-address-issues-of-ended-subscriptions');

const squash = (sql) => sql.replace(/\s+/g, ' ').trim();

function runner({ tables = true } = {}) {
  return {
    hasTable: jest.fn(async () => tables),
    query: jest.fn(async () => ({ affectedRows: 1 }))
  };
}

// close-address-issues-when-subscription-ends
describe('CloseAddressIssuesOfEndedSubscriptions1700000000072', () => {
  test('closes as ended the open problems of canceled subscriptions with no paid box left', async () => {
    const queryRunner = runner();
    await new CloseAddressIssuesOfEndedSubscriptions1700000000072().up(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    const [sql, params] = queryRunner.query.mock.calls[0];
    const flat = squash(sql);
    expect(flat).toContain("i.`resolved_by` = 'ended'");
    expect(flat).toContain("s.`status` = 'canceled'");
    expect(flat).toContain('c.paid_at IS NOT NULL AND c.paid_invoice_id IS NOT NULL');
    expect(flat).toContain("cd.status IN ('out_for_delivery', 'delivered')");
    expect(flat).toContain("us.status IN ('created', 'delivered')");
    expect(flat).toContain('us.stripe_invoice_id COLLATE utf8mb4_unicode_ci = c.paid_invoice_id COLLATE utf8mb4_unicode_ci');
    expect(flat).not.toContain('i.`subscription_id` = ?');
    expect(params).toBeUndefined();
  });

  test('a missing table skips the migration', async () => {
    const queryRunner = runner({ tables: false });
    await new CloseAddressIssuesOfEndedSubscriptions1700000000072().up(queryRunner);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  test('down reopens nothing', async () => {
    const queryRunner = runner();
    await new CloseAddressIssuesOfEndedSubscriptions1700000000072().down(queryRunner);
    expect(queryRunner.query).not.toHaveBeenCalled();
  });
});
