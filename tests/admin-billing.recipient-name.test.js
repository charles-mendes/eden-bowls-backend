const { AdminBillingService } = require('../src/services/admin-billing.service');

// operator-fills-recipient-name: the operator fills the missing recipient of one subscription.
const brOperator = { userId: 5, email: 'op@edenbowls.com', roles: ['operator'], markets: ['BR'] };
const usOperator = { userId: 6, email: 'us@edenbowls.com', roles: ['operator'], markets: ['US'] };
const address = { country: 'BR', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80000-000' };

function build({ row = {}, filled = true, user = { displayName: 'Ana Costa' } } = {}) {
  const item = { id: 200, userId: 9, customerEmail: 'ana@example.com', stripeSubscriptionId: 'sub_1', status: 'active', stripeAccount: 'br', profileMarket: 'BR', address, ...row };
  const ledgerRepository = {
    findById: jest.fn(async () => item),
    fillAddressRecipientName: jest.fn(async () => filled)
  };
  const auditService = { record: jest.fn(async () => undefined) };
  const addressIssueService = { recheckSubscription: jest.fn(async () => ({ closed: true, codes: [] })), latestFor: jest.fn(async () => null) };
  const profileRepository = { findUserById: jest.fn(async () => user) };
  const service = new AdminBillingService({
    ledgerRepository,
    auditService,
    addressIssueService,
    profileRepository,
    stripeAccounts: { us: { secretKey: 'sk_test_us' }, br: { secretKey: 'sk_test_br' } }
  });
  return { service, ledgerRepository, auditService, addressIssueService, profileRepository };
}

const status = (promise) => promise.then(() => null, (error) => ({ status: error.statusCode, code: error.details && error.details.code, field: error.details && error.details.field }));

describe('fillRecipientName', () => {
  test('fills a missing recipient, audits without the name and checks the problem again as the operator', async () => {
    const { service, ledgerRepository, auditService, addressIssueService } = build();
    const result = await service.fillRecipientName('200', { recipient_name: '  Ana   Costa ' }, brOperator);

    expect(result).toEqual({ success: true, data: { subscription_id: '200', recipient_name: 'Ana Costa', courier_issues: [] } });
    expect(ledgerRepository.fillAddressRecipientName).toHaveBeenCalledWith(200, 'Ana Costa');
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'billing.subscriptions.recipient.fill',
      targetUserId: 9,
      metadata: { subscriptionId: '200', fields: ['recipient_name'] }
    }));
    expect(JSON.stringify(auditService.record.mock.calls[0][0].metadata)).not.toContain('Ana');
    const [saved, options] = addressIssueService.recheckSubscription.mock.calls[0];
    expect(saved.address.recipient_name).toBe('Ana Costa');
    expect(options).toEqual({ resolvedBy: 'operator' });
  });

  test('other address codes stay in courier_issues', async () => {
    const { service } = build({ row: { address: { ...address, number: '' } } });
    const result = await service.fillRecipientName('200', { recipient_name: 'Ana Costa' }, brOperator);
    expect(result.data.courier_issues).toEqual(['address_number_missing']);
  });

  test('a recipient already present answers 409 and writes nothing', async () => {
    const { service, ledgerRepository, auditService } = build({ row: { address: { ...address, recipient_name: 'João Lima' } } });
    expect(await status(service.fillRecipientName('200', { recipient_name: 'Ana Costa' }, brOperator))).toMatchObject({ status: 409, code: 'recipient_name_present' });
    expect(ledgerRepository.fillAddressRecipientName).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  test('a legacy name key counts as a recipient', async () => {
    const { service } = build({ row: { address: { ...address, full_name: 'Bruno Lima' } } });
    expect(await status(service.fillRecipientName('200', { recipient_name: 'Ana Costa' }, brOperator))).toMatchObject({ status: 409 });
  });

  test('a name written in between answers 409', async () => {
    const { service, auditService, addressIssueService } = build({ filled: false });
    expect(await status(service.fillRecipientName('200', { recipient_name: 'Ana Costa' }, brOperator))).toMatchObject({ status: 409, code: 'recipient_name_present' });
    expect(auditService.record).not.toHaveBeenCalled();
    expect(addressIssueService.recheckSubscription).not.toHaveBeenCalled();
  });

  test.each([['12'], [''], [undefined], ['ana@example.com']])('an invalid name %p answers 422 and writes nothing', async (name) => {
    const { service, ledgerRepository } = build();
    expect(await status(service.fillRecipientName('200', { recipient_name: name }, brOperator))).toMatchObject({ status: 422, field: 'recipient_name' });
    expect(ledgerRepository.fillAddressRecipientName).not.toHaveBeenCalled();
  });

  test('another market answers 404 and writes nothing', async () => {
    const { service, ledgerRepository } = build();
    expect(await status(service.fillRecipientName('200', { recipient_name: 'Ana Costa' }, usOperator))).toMatchObject({ status: 404 });
    expect(ledgerRepository.fillAddressRecipientName).not.toHaveBeenCalled();
  });

  test('an unknown subscription answers 404', async () => {
    const { service, ledgerRepository } = build();
    ledgerRepository.findById.mockResolvedValueOnce(null);
    expect(await status(service.fillRecipientName('999', { recipient_name: 'Ana Costa' }, brOperator))).toMatchObject({ status: 404 });
  });
});

describe('subscription detail carries the account name only for a profile in scope', () => {
  test('profile in the actor market: account name and the shown name source', async () => {
    const { service } = build();
    await expect(service.getSubscription('200', brOperator, { detail: true })).resolves.toMatchObject({ account_name: 'Ana Costa', name_source: 'account' });
  });

  test('profile in another market: no account name and no profile read', async () => {
    const { service, profileRepository } = build({ row: { profileMarket: 'US' } });
    await expect(service.getSubscription('200', brOperator, { detail: true })).resolves.toMatchObject({ account_name: null, name_source: 'email' });
    expect(profileRepository.findUserById).not.toHaveBeenCalled();
  });

  test('an email as account name is not a name', async () => {
    const { service } = build({ user: { displayName: 'ana@example.com' } });
    await expect(service.getSubscription('200', brOperator, { detail: true })).resolves.toMatchObject({ account_name: null, name_source: 'email' });
  });
});

describe('subscription detail carries the delivery instructions with their source', () => {
  test('the subscription text comes first', async () => {
    const { service, profileRepository } = build({ row: { address: { ...address, delivery_instructions: 'Portão verde' } } });
    profileRepository.getAddress = jest.fn(async () => ({ exists: true, address: { ...address, delivery_instructions: 'Interfone 12' } }));
    await expect(service.getSubscription('200', brOperator, { detail: true }))
      .resolves.toMatchObject({ delivery_instructions: 'Portão verde', delivery_instructions_source: 'subscription' });
  });

  test('the profile text only for the same place', async () => {
    const same = build();
    same.profileRepository.getAddress = jest.fn(async () => ({ exists: true, address: { ...address, delivery_instructions: 'Interfone 12' } }));
    await expect(same.service.getSubscription('200', brOperator, { detail: true }))
      .resolves.toMatchObject({ delivery_instructions: 'Interfone 12', delivery_instructions_source: 'profile' });

    const other = build();
    other.profileRepository.getAddress = jest.fn(async () => ({ exists: true, address: { ...address, number: '99', delivery_instructions: 'Interfone 12' } }));
    await expect(other.service.getSubscription('200', brOperator, { detail: true }))
      .resolves.toMatchObject({ delivery_instructions: null, delivery_instructions_source: null });
  });

  test('a profile in another market is not read', async () => {
    const { service, profileRepository } = build({ row: { profileMarket: 'US' } });
    profileRepository.getAddress = jest.fn();
    await expect(service.getSubscription('200', brOperator, { detail: true }))
      .resolves.toMatchObject({ delivery_instructions: null, delivery_instructions_source: null });
    expect(profileRepository.getAddress).not.toHaveBeenCalled();
  });
});
