const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR } = require('../src/core/delivery-closed-days');
const { buildAutoRenewOffEmail } = require('../src/core/email/transactional-emails');
const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');
const { SubscriptionsActionsRepository } = require('../src/infrastructure/repositories/subscriptions-actions.repository');
const { SubscriptionDeliveriesRepository } = require('../src/infrastructure/repositories/subscription-deliveries.repository');
const { CustomerDeliveriesService } = require('../src/services/customer-deliveries.service');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');

const rows = buildSeedRows();
const at = (year, month, day, hour = 0) => wallTimeToUtc(year, month, day, hour, 0, 0, TIMEZONE_BR);

describe('automatic renewal off letter (3.11)', () => {
  test('says the plan ends after the last delivery, with its date, in both languages', () => {
    const pt = buildAutoRenewOffEmail({ petName: 'Luna', endsOnLabel: '4 de fev. de 2026', locale: 'pt-BR' });
    const en = buildAutoRenewOffEmail({ petName: 'Luna', endsOnLabel: 'Feb 4, 2026', locale: 'en-US' });

    expect(pt.text).toContain('Renovação automática desligada. Seu plano termina depois da última entrega, em 4 de fev. de 2026.');
    expect(pt.html).toContain('Renovação automática desligada. Seu plano termina depois da última entrega, em 4 de fev. de 2026.');
    expect(en.text).toContain('Automatic renewal is off. Your plan ends after your last delivery, on Feb 4, 2026.');
    expect(en.subject).toBe('Automatic renewal is off');
  });

  test('the mailer formats the delivery date in the market language and claims template auto_renew_off', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const claimMailSend = jest.fn().mockResolvedValue({ claimed: true, id: 1 });
    const mailer = createTransactionalMailer({
      otpMailer: { sendMail },
      claimsRepository: { claimMailSend, markSent: jest.fn(), savePayload: jest.fn() }
    });
    await mailer.notifyAutoRenewOff({
      ledger: { customerEmail: 'ana@example.com', address: { country: 'BR' }, stripeAccount: 'br' },
      subscriptionId: 'sub_123',
      referenceId: 'auto_renew_off:1',
      endsOn: '2026-02-04'
    });
    expect(claimMailSend.mock.calls[0][0]).toMatchObject({ template: 'auto_renew_off', referenceId: 'auto_renew_off:1' });
    expect(sendMail.mock.calls[0][0].text).toMatch(/Seu plano termina depois da última entrega, em 4 de fev\.? de 2026\./);
  });
});

describe('turning automatic renewal off (3.11)', () => {
  // Brazil, 3 month term, one delivery charged: with renewal off the last contracted delivery is 4 February.
  function setup({ autoRenew = true, mailer } = {}) {
    let row = {
      id: 1,
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      stripeAccount: 'br',
      status: 'active',
      customerEmail: 'ana@example.com',
      currentPeriodEnd: at(2026, 1, 3, 14),
      subscriptionTermMonths: 3,
      chargedDeliveries: 1,
      autoRenew,
      planSelection: { catalog_pricing: { subtotal: 100, line_items: [{ quantity: 8 }] } },
      address: { country: 'BR' },
      shipping: { distance: 10 }
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn(async () => ({ ...row })),
      setAutoRenew: jest.fn(async (_id, enabled) => { row = { ...row, autoRenew: enabled }; return row; })
    };
    const deliveries = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      subscriptions: new SubscriptionDeliveriesRepository({ ledgerRepository }),
      now: () => at(2026, 1, 1, 12)
    });
    const stripeBilling = { setCancelAtPeriodEnd: jest.fn().mockResolvedValue({}) };
    const transactionalMailer = mailer || { notifyAutoRenewOff: jest.fn().mockResolvedValue({ sent: true }) };
    const repository = new SubscriptionsActionsRepository({
      ledgerRepository,
      stripeBilling,
      deliveries,
      transactionalMailer,
      logger: { info() {}, warn: jest.fn(), error: jest.fn() },
      now: () => at(2026, 1, 1, 12)
    });
    return { repository, transactionalMailer, stripeBilling };
  }

  test('sends the letter at once with the last contracted delivery date', async () => {
    const { repository, transactionalMailer, stripeBilling } = setup();
    await repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false });

    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
    expect(transactionalMailer.notifyAutoRenewOff).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      endsOn: '2026-02-04',
      referenceId: `auto_renew_off:${at(2026, 1, 1, 12).toISOString()}`
    }));
  });

  test('turning renewal on, or off again while already off, sends no letter', async () => {
    const on = setup({ autoRenew: false });
    await on.repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: true });
    expect(on.transactionalMailer.notifyAutoRenewOff).not.toHaveBeenCalled();

    const again = setup({ autoRenew: false });
    await again.repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false });
    expect(again.transactionalMailer.notifyAutoRenewOff).not.toHaveBeenCalled();
  });

  test('a failed letter does not undo turning renewal off', async () => {
    const { repository } = setup({ mailer: { notifyAutoRenewOff: jest.fn().mockRejectedValue(new Error('smtp down')) } });
    await expect(repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false }))
      .resolves.toMatchObject({ action: 'toggle_auto_renew' });
  });
});

describe('turning automatic renewal back on stops the scheduled end letter (3.11)', () => {
  test('the last delivery charged after renewal was turned back on does not schedule the end', async () => {
    const setCancelAtPeriodEnd = jest.fn();
    const ledgerRow = { stripeSubscriptionId: 'sub_123', chargedDeliveries: 2, subscriptionTermMonths: 3, autoRenew: true };
    const webhook = new StripeWebhookService({
      ledgerRepository: {
        findByStripeSubscriptionId: jest.fn().mockResolvedValue(ledgerRow),
        incrementChargedDeliveries: jest.fn().mockResolvedValue({ ...ledgerRow, chargedDeliveries: 3 })
      }
    });
    await webhook.recordChargedDelivery({
      invoice: { id: 'in_3', billing_reason: 'subscription_cycle', subtotal: 9600 },
      subscriptionId: 'sub_123',
      subscription: { cancel_at_period_end: false },
      billing: { setCancelAtPeriodEnd }
    });
    expect(setCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  test('a scheduled-end event processed after renewal was turned back on sends no letter', async () => {
    const notifyCancelled = jest.fn();
    const webhook = new StripeWebhookService({
      ledgerRepository: { findByStripeSubscriptionId: jest.fn().mockResolvedValue({ customerEmail: 'ana@example.com' }) },
      transactionalMailer: { notifyCancelled }
    });
    const event = { id: 'evt_1', type: 'customer.subscription.updated', data: { previous_attributes: { cancel_at_period_end: false } } };
    const scheduled = { id: 'sub_123', cancel_at_period_end: true, current_period_end: 1790000000 };

    await webhook.notifySubscriptionTransition({
      subscription: scheduled,
      subscriptionId: 'sub_123',
      event,
      stripeBilling: { retrieveSubscription: jest.fn().mockResolvedValue({ id: 'sub_123', cancel_at_period_end: false }) }
    });
    expect(notifyCancelled).not.toHaveBeenCalled();

    await webhook.notifySubscriptionTransition({
      subscription: scheduled,
      subscriptionId: 'sub_123',
      event,
      stripeBilling: { retrieveSubscription: jest.fn().mockResolvedValue({ id: 'sub_123', cancel_at_period_end: true }) }
    });
    expect(notifyCancelled).toHaveBeenCalledTimes(1);
  });
});
