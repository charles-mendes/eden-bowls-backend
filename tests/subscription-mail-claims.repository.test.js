const { SubscriptionMailClaimsRepository } = require('../src/infrastructure/repositories/subscription-mail-claims.repository');
const { RESEND_TEMPLATES } = require('../src/infrastructure/mailers/transactional-mailer');

describe('SubscriptionMailClaimsRepository resend selection', () => {
  test('selects only unsent unexhausted transactional templates', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new SubscriptionMailClaimsRepository({ isInitialized: true, query });
    const olderThan = new Date('2026-01-01T00:00:00Z');

    await repository.listResendable({
      olderThan,
      limit: 20,
      templates: RESEND_TEMPLATES
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('`sent_at` IS NULL');
    expect(sql).toContain('`exhausted_at` IS NULL');
    expect(sql).toContain('`claimed_at` <= ?');
    expect(sql).toContain('LIMIT ?');
    expect(params).toEqual([
      olderThan,
      'order_confirmed',
      'admin_new_subscription',
      'payment_failed',
      'shipped',
      20
    ]);
    expect(params).not.toContain('otp');
    expect(params).not.toContain('invite');
  });
});
