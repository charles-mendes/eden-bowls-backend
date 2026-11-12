const { DeliveryAddressIssueService, presentAddressIssue } = require('../src/services/delivery-address-issue.service');

const CPF = '52998224725';
const NOW = new Date('2026-11-03T12:00:00Z');
const FULL_BR = { country: 'BR', street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80010000', recipient_name: 'Ana Costa' };

function memoryIssues() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    findOpen: jest.fn(async (subscriptionId) => rows.find((row) => row.open && row.subscriptionId === subscriptionId) || null),
    insertOpen: jest.fn(async (input) => {
      const found = rows.find((row) => row.open && row.subscriptionId === input.subscriptionId);
      if (found) return { inserted: false, issue: found };
      const issue = { id: nextId++, subscriptionId: input.subscriptionId, stripeSubscriptionId: input.stripeSubscriptionId, userId: input.userId, stripeAccount: input.stripeAccount, codes: input.codes, source: input.source, open: true, openedAt: input.now, emailSentAt: null, resolvedAt: null, resolvedBy: null };
      rows.push(issue);
      return { inserted: true, issue };
    }),
    close: jest.fn(async (id, { resolvedBy, now }) => {
      const row = rows.find((item) => item.id === id && item.open);
      if (!row) return false;
      Object.assign(row, { open: false, resolvedBy, resolvedAt: now });
      return true;
    }),
    updateCodes: jest.fn(async (id, codes) => { rows.find((row) => row.id === id).codes = codes; }),
    markEmailSent: jest.fn(async (id, now) => { rows.find((row) => row.id === id).emailSentAt = now; }),
    listOpenByUser: jest.fn(async (userId) => rows.filter((row) => row.open && row.userId === userId)),
    latestForSubscriptions: jest.fn(async (ids) => new Map(ids.map((id) => [id, rows.find((row) => row.subscriptionId === id)]).filter(([, row]) => row)))
  };
}

function build({ fiscal = { taxDocument: CPF, fiscalName: 'Ana Costa' }, mailer, ledgers = [] } = {}) {
  const repository = memoryIssues();
  const fiscalData = { ...fiscal };
  const fiscalRepository = { findFiscalData: jest.fn(async () => fiscalData) };
  const ledgerRepository = { findByStripeSubscriptionId: jest.fn(async (id) => ledgers.find((ledger) => ledger.stripeSubscriptionId === id) || null) };
  const mail = mailer || { notifyDeliveryAddressIssue: jest.fn(async () => ({ claimed: true, skipped: false })) };
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const service = new DeliveryAddressIssueService({ repository, fiscalRepository, ledgerRepository, mailer: mail, logger, now: () => NOW });
  return { service, repository, fiscalData, mailer: mail, logger };
}

const brSub = (address = {}, overrides = {}) => ({ id: 5, stripeSubscriptionId: 'sub_5', userId: 7, stripeAccount: 'br', customerEmail: 'ana@example.com', address: { ...FULL_BR, ...address }, ...overrides });

describe('report', () => {
  test('opens a problem with every code still wrong, and sends one email', async () => {
    const { service, repository, mailer } = build({ fiscal: { taxDocument: CPF, fiscalName: '' } });
    const issue = await service.report({ subscription: brSub({ number: '' }), source: 'courier_check' });
    expect(issue).toMatchObject({ codes: ['address_number_missing', 'fiscal_name_missing'], source: 'courier_check', stripeAccount: 'br' });
    expect(mailer.notifyDeliveryAddressIssue).toHaveBeenCalledTimes(1);
    expect(repository.rows[0].emailSentAt).toEqual(NOW);
  });

  test('nfe_check then payment_check on the same payment give one problem and one email', async () => {
    const { service, repository, mailer } = build({ fiscal: { taxDocument: CPF, fiscalName: '' } });
    const subscription = brSub({ neighborhood: '' });
    await service.report({ subscription, source: 'nfe_check' });
    await service.report({ subscription, source: 'payment_check' });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].codes).toEqual(['address_neighborhood_missing', 'fiscal_name_missing']);
    expect(mailer.notifyDeliveryAddressIssue).toHaveBeenCalledTimes(1);
  });

  test('another set supersedes the open problem and sends a new email', async () => {
    const { service, repository, mailer } = build();
    await service.report({ subscription: brSub({ number: '' }), source: 'courier_check' });
    await service.report({ subscription: brSub({ neighborhood: '' }), source: 'courier_check' });
    expect(repository.rows.map((row) => [row.codes, row.open, row.resolvedBy])).toEqual([
      [['address_number_missing'], false, 'superseded'],
      [['address_neighborhood_missing'], true, null]
    ]);
    expect(mailer.notifyDeliveryAddressIssue).toHaveBeenCalledTimes(2);
  });

  test('a market exception or a complete address opens nothing', async () => {
    const { service, repository, mailer } = build();
    expect(await service.report({ subscription: brSub({ country: 'US', number: '' }), source: 'payment_check' })).toBeNull();
    expect(await service.report({ subscription: brSub(), source: 'payment_check' })).toBeNull();
    expect(repository.insertOpen).not.toHaveBeenCalled();
    expect(mailer.notifyDeliveryAddressIssue).not.toHaveBeenCalled();
  });

  test('US: one address code, no fiscal codes', async () => {
    const { service, repository } = build({ fiscal: {} });
    await service.report({ subscription: { id: 8, stripeSubscriptionId: 'sub_8', userId: 7, stripeAccount: 'us', address: { country: 'US', street: 'PO Box 12', city: 'Miami', state: 'FL', zipcode: '33101' } }, source: 'ups_check' });
    expect(repository.rows[0].codes).toEqual(['po_box_not_allowed']);
  });

  test('courier_failed adds courier_address_unusable, and it stays on later events', async () => {
    const { service, repository } = build();
    await service.report({ subscription: brSub(), source: 'courier_failed', extra: ['courier_address_unusable'] });
    await service.report({ subscription: brSub(), source: 'payment_check' });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0].codes).toEqual(['courier_address_unusable']);
  });

  test('an SMTP failure leaves email_sent_at empty', async () => {
    const { service, repository } = build({ mailer: { notifyDeliveryAddressIssue: jest.fn(async () => ({ failed: true, claimed: false })) } });
    await service.report({ subscription: brSub({ number: '' }), source: 'courier_check' });
    expect(repository.rows[0].emailSentAt).toBeNull();
  });

  test('an error only goes to the log', async () => {
    const { service, repository, logger } = build();
    repository.findOpen.mockRejectedValueOnce(new Error('db down'));
    await expect(service.report({ subscription: brSub({ number: '' }), source: 'courier_check' })).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('recheckForUser', () => {
  test('a fixed address closes the problem as customer', async () => {
    const ledger = brSub({ number: '' });
    const { service, repository, mailer } = build({ ledgers: [ledger] });
    await service.report({ subscription: ledger, source: 'courier_check' });
    ledger.address.number = '10';
    expect(await service.recheckForUser(7, { addressSavedFor: ['sub_5'] })).toEqual({ closed: 1, updated: 0 });
    expect(repository.rows[0]).toMatchObject({ open: false, resolvedBy: 'customer' });
    expect(mailer.notifyDeliveryAddressIssue).toHaveBeenCalledTimes(1);
  });

  test('only the number saved, CPF still missing: stays open with the CPF code and no email', async () => {
    const ledger = brSub({ number: '' });
    const { service, repository, mailer } = build({ fiscal: { taxDocument: '', fiscalName: 'Ana Costa' }, ledgers: [ledger] });
    await service.report({ subscription: ledger, source: 'courier_check' });
    ledger.address.number = '10';
    expect(await service.recheckForUser(7, { addressSavedFor: ['sub_5'] })).toEqual({ closed: 0, updated: 1 });
    expect(repository.rows[0]).toMatchObject({ open: true, codes: ['tax_document_missing'] });
    expect(mailer.notifyDeliveryAddressIssue).toHaveBeenCalledTimes(1);
  });

  test('a fiscal name saved on one subscription closes the other BR subscription too', async () => {
    const first = brSub();
    const second = brSub({}, { id: 6, stripeSubscriptionId: 'sub_6' });
    const { service, repository, fiscalData } = build({ fiscal: { taxDocument: CPF, fiscalName: '' }, ledgers: [first, second] });
    await service.report({ subscription: first, source: 'nfe_check' });
    await service.report({ subscription: second, source: 'nfe_check' });
    fiscalData.fiscalName = 'Ana Costa';
    expect(await service.recheckForUser(7, { addressSavedFor: ['sub_5'] })).toEqual({ closed: 2, updated: 0 });
    expect(repository.rows.every((row) => !row.open)).toBe(true);
  });

  test('a new address clears courier_address_unusable; a save elsewhere keeps it', async () => {
    const ledger = brSub();
    const { service, repository } = build({ ledgers: [ledger] });
    await service.report({ subscription: ledger, source: 'courier_failed', extra: ['courier_address_unusable'] });
    expect(await service.recheckForUser(7, { addressSavedFor: ['sub_other'] })).toEqual({ closed: 0, updated: 0 });
    expect(repository.rows[0].open).toBe(true);
    expect(await service.recheckForUser(7, { addressSavedFor: ['sub_5'] })).toEqual({ closed: 1, updated: 0 });
  });
});

// operator-fills-recipient-name: the operator filled the recipient of one subscription in the panel.
describe('recheckSubscription', () => {
  const noName = { recipient_name: '' };

  test('closes the problem as the operator when nothing is left, without an email', async () => {
    const { service, repository, mailer: mail } = build();
    await service.report({ subscription: brSub(noName), source: 'courier_check' });
    mail.notifyDeliveryAddressIssue.mockClear();
    const result = await service.recheckSubscription(brSub({ recipient_name: 'Ana Costa' }));
    expect(result).toEqual({ closed: true, codes: [] });
    expect(repository.rows[0]).toMatchObject({ open: false, resolvedBy: 'operator' });
    expect(mail.notifyDeliveryAddressIssue).not.toHaveBeenCalled();
  });

  test('keeps what is left on the same problem, without an email', async () => {
    const { service, repository, mailer: mail } = build();
    await service.report({ subscription: brSub({ ...noName, number: '' }), source: 'courier_check' });
    mail.notifyDeliveryAddressIssue.mockClear();
    const result = await service.recheckSubscription(brSub({ recipient_name: 'Ana Costa', number: '' }));
    expect(result).toEqual({ closed: false, codes: ['address_number_missing'] });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]).toMatchObject({ open: true, codes: ['address_number_missing'] });
    expect(mail.notifyDeliveryAddressIssue).not.toHaveBeenCalled();
  });

  test('keeps the courier refusal of the address', async () => {
    const { service, repository } = build();
    await service.report({ subscription: brSub(noName), source: 'courier_failed', extra: ['courier_address_unusable'] });
    await service.recheckSubscription(brSub({ recipient_name: 'Ana Costa' }));
    expect(repository.rows[0]).toMatchObject({ open: true, codes: ['courier_address_unusable'] });
  });

  test('no open problem: nothing to do', async () => {
    const { service, repository } = build();
    expect(await service.recheckSubscription(brSub())).toBeNull();
    expect(repository.close).not.toHaveBeenCalled();
  });
});

describe('latestForSubscriptions', () => {
  test('presents the problem per ledger id, and an error reads as none', async () => {
    const { service, repository } = build();
    await service.report({ subscription: brSub({ number: '' }), source: 'courier_check' });
    const latest = await service.latestForSubscriptions([5, 6]);
    expect(latest.get(5)).toEqual({
      id: 1,
      codes: ['address_number_missing'],
      source: 'courier_check',
      open: true,
      opened_at: NOW.toISOString(),
      email_sent_at: NOW.toISOString(),
      resolved_at: null,
      resolved_by: null
    });
    expect(latest.has(6)).toBe(false);
    repository.latestForSubscriptions.mockRejectedValueOnce(new Error('db down'));
    expect((await service.latestForSubscriptions([5])).size).toBe(0);
    expect(presentAddressIssue(null)).toBeNull();
  });
});

// close-address-issues-when-subscription-ends
describe('closeIfEnded', () => {
  test('asks the repository to close the subscription as ended, without an email', async () => {
    const { service, repository, mailer } = build();
    repository.closeEnded = jest.fn(async () => 1);
    await expect(service.closeIfEnded(179)).resolves.toBe(1);
    expect(repository.closeEnded).toHaveBeenCalledWith({ subscriptionId: 179, now: NOW });
    expect(mailer.notifyDeliveryAddressIssue).not.toHaveBeenCalled();
  });

  test('a repository error is logged and never thrown', async () => {
    const { service, repository, logger } = build();
    repository.closeEnded = jest.fn(async () => { throw new Error('db down'); });
    await expect(service.closeIfEnded(179)).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 179, message: 'db down' }), expect.any(String));
  });

  test('no repository rule or no id: nothing to do', async () => {
    const { service, repository } = build();
    await expect(service.closeIfEnded(179)).resolves.toBe(0);
    repository.closeEnded = jest.fn();
    await expect(service.closeIfEnded(null)).resolves.toBe(0);
    expect(repository.closeEnded).not.toHaveBeenCalled();
  });
});
