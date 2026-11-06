const { AdminBillingService } = require('../src/services/admin-billing.service');

function detailFor(row) {
  const service = new AdminBillingService({
    ledgerRepository: { findById: jest.fn().mockResolvedValue({ id: 42, userId: 9, stripeSubscriptionId: 'sub_1', status: 'active', ...row }) },
    stripeAccounts: { us: { secretKey: 'sk_test_us' }, br: { secretKey: 'sk_test_br' } }
  });
  return service.getSubscription('42', { roles: ['admin'] });
}

describe('admin subscription detail states its shipping market', () => {
  test('a US account delivered in Brazil is a market exception', async () => {
    await expect(detailFor({ stripeAccount: 'us', address: { country: 'BR' } }))
      .resolves.toMatchObject({ shipment_market: null, market_exception: true });
  });

  test('a Brazil account delivered in Brazil ships from Brazil', async () => {
    await expect(detailFor({ stripeAccount: 'br', address: { country: 'BR' } }))
      .resolves.toMatchObject({ shipment_market: 'BR', market_exception: false });
  });
});

describe('admin subscription detail carries the address problem', () => {
  const issue = { id: 3, codes: ['address_number_missing'], source: 'courier_check', open: true, opened_at: '2026-11-03T12:00:00.000Z', email_sent_at: '2026-11-03T12:00:01.000Z', resolved_at: null, resolved_by: null };
  const build = () => {
    const addressIssueService = { latestFor: jest.fn(async () => issue) };
    const service = new AdminBillingService({
      ledgerRepository: { findById: jest.fn().mockResolvedValue({ id: 42, userId: 9, stripeSubscriptionId: 'sub_1', status: 'active', stripeAccount: 'br', address: { country: 'BR' } }) },
      stripeAccounts: { us: { secretKey: 'sk_test_us' }, br: { secretKey: 'sk_test_br' } },
      addressIssueService
    });
    return { service, addressIssueService };
  };

  test('the panel detail reads the problem of the ledger row', async () => {
    const { service, addressIssueService } = build();
    await expect(service.getSubscription('42', { roles: ['admin'] }, { detail: true })).resolves.toMatchObject({ address_issue: issue });
    expect(addressIssueService.latestFor).toHaveBeenCalledWith(42);
  });

  test('the courier and the label read the subscription without it', async () => {
    const { service, addressIssueService } = build();
    const subscription = await service.getSubscription('42', { roles: ['admin'] });
    expect(subscription).not.toHaveProperty('address_issue');
    expect(addressIssueService.latestFor).not.toHaveBeenCalled();
  });
});
