const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');

function buildMailer(overrides = {}) {
  const sendMail = overrides.sendMail || jest.fn().mockResolvedValue({ skipped: false });
  const claimMailSend = overrides.claimMailSend || jest.fn().mockResolvedValue({ claimed: true, id: 1 });
  const markSent = overrides.markSent || jest.fn().mockResolvedValue(undefined);
  const savePayload = overrides.savePayload || jest.fn().mockResolvedValue(undefined);
  const recordSendFailure = overrides.recordSendFailure || jest.fn().mockResolvedValue({ attempts: 1, exhausted: false });
  const releaseUnsent = overrides.releaseUnsent || jest.fn().mockResolvedValue(undefined);
  const listResendable = overrides.listResendable || jest.fn().mockResolvedValue([]);
  const logger = overrides.logger || { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const mailer = createTransactionalMailer({
    otpMailer: { sendMail },
    claimsRepository: { claimMailSend, markSent, savePayload, recordSendFailure, releaseUnsent, listResendable },
    storeAppUrl: 'http://localhost:5173',
    adminAppUrl: 'http://localhost:5174',
    opsEmails: overrides.opsEmails === undefined ? ['ops@edenbowls.com'] : overrides.opsEmails,
    logger
  });
  return { mailer, sendMail, claimMailSend, markSent, savePayload, recordSendFailure, releaseUnsent, listResendable, logger };
}

const ledger = {
  stripeSubscriptionId: 'sub_123',
  customerEmail: 'ana@example.com',
  planLabel: 'Fresh Bowl',
  address: { name: 'Ana Costa', country: 'BR' },
  petsSnapshot: { pets_names: ['Luna'] },
  planSelection: { pets: [{ selected_flavors: ['Bovino'] }] }
};

describe('createTransactionalMailer', () => {
  test('sends order-confirmed once; duplicate claim does not call sendMail', async () => {
    const claimMailSend = jest.fn()
      .mockResolvedValueOnce({ claimed: true, id: 8 })
      .mockResolvedValueOnce({ claimed: false });
    const { mailer, sendMail, markSent } = buildMailer({ claimMailSend });
    const invoice = {
      id: 'in_1',
      amount_paid: 18900,
      currency: 'brl',
      customer_email: 'ana@example.com'
    };

    await mailer.notifyOrderConfirmed({ invoice, ledger, subscriptionId: 'sub_123' });
    await mailer.notifyOrderConfirmed({ invoice, ledger, subscriptionId: 'sub_123' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'ana@example.com',
      subject: expect.stringContaining('Luna')
    });
    expect(markSent).toHaveBeenCalledWith(8);
  });

  test('tries SMTP three times, then releases the unsent claim', async () => {
    const sendMail = jest.fn().mockRejectedValue({ code: 'EENVELOPE' });
    const { mailer, markSent, releaseUnsent, logger } = buildMailer({ sendMail });

    await expect(mailer.notifyOrderConfirmed({
      invoice: { id: 'in_1', amount_paid: 1000, currency: 'usd' },
      ledger,
      subscriptionId: 'sub_123'
    })).resolves.toMatchObject({ failed: true, claimed: false });

    expect(sendMail).toHaveBeenCalledTimes(3);
    expect(markSent).not.toHaveBeenCalled();
    expect(releaseUnsent).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'order_confirmed',
        subscriptionId: 'sub_123',
        code: 'EENVELOPE'
      }),
      'Transactional email failed.'
    );
  });

  test('skips admin mail when MAIL_OPS_TO is empty', async () => {
    const { mailer, sendMail, claimMailSend } = buildMailer({ opsEmails: [] });

    await expect(mailer.notifyAdminNewSubscription({
      invoice: { id: 'in_1' },
      ledger,
      subscriptionId: 'sub_123'
    })).resolves.toMatchObject({ skipped: true, reason: 'no_ops_recipients' });

    expect(claimMailSend).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('claims admin_new_subscription once per invoice and sends to ops', async () => {
    const { mailer, sendMail, claimMailSend } = buildMailer({
      opsEmails: ['ops@edenbowls.com', 'ops2@edenbowls.com']
    });

    await mailer.notifyAdminNewSubscription({
      invoice: { id: 'in_1', amount_paid: 18900, currency: 'usd' },
      ledger,
      subscriptionId: 'sub_123'
    });

    expect(claimMailSend).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      template: 'admin_new_subscription',
      referenceId: 'in_1'
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  test('resends an unsent claim once without a second claim insert', async () => {
    const sendMail = jest.fn().mockResolvedValue({ skipped: false });
    const listResendable = jest.fn().mockResolvedValue([{
      id: 4,
      template: 'order_confirmed',
      sentAt: null,
      payload: { to: 'ana@example.com', subject: 's', text: 't', html: '<p>t</p>' }
    }]);
    const { mailer, markSent, claimMailSend } = buildMailer({ sendMail, listResendable });

    await mailer.resendUnsent({ now: new Date('2026-01-01T00:02:00Z') });

    expect(claimMailSend).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(4);
    expect(listResendable).toHaveBeenCalledWith(expect.objectContaining({
      olderThan: new Date('2026-01-01T00:00:00Z'),
      limit: 20,
      templates: ['order_confirmed', 'admin_new_subscription', 'payment_failed', 'shipped']
    }));
  });

  test('does not send a claim that already has sent_at', async () => {
    const listResendable = jest.fn().mockResolvedValue([{
      id: 4,
      template: 'order_confirmed',
      sentAt: '2026-01-01 00:00:00',
      payload: { to: 'ana@example.com', subject: 's', text: 't', html: '<p>t</p>' }
    }]);
    const { mailer, sendMail, claimMailSend } = buildMailer({ listResendable });

    await mailer.resendUnsent();

    expect(sendMail).not.toHaveBeenCalled();
    expect(claimMailSend).not.toHaveBeenCalled();
  });

  test('stops after five attempts and logs the fifth failure as exhausted', async () => {
    const recordSendFailure = jest.fn().mockResolvedValue({ attempts: 5, exhausted: true });
    const listResendable = jest.fn()
      .mockResolvedValueOnce([{
        id: 9,
        template: 'payment_failed',
        sentAt: null,
        payload: { to: 'ana@example.com', subject: 's', text: 't', html: '<p>t</p>' }
      }])
      .mockResolvedValueOnce([]);
    const sendMail = jest.fn().mockRejectedValue(new Error('smtp down'));
    const { mailer, logger, markSent } = buildMailer({ recordSendFailure, listResendable, sendMail });

    await mailer.resendUnsent();
    await mailer.resendUnsent();

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(markSent).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'exhausted', claimId: 9 }),
      'Transactional email exhausted.'
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('sends at most 20 claims in one resend tick', async () => {
    const rows = Array.from({ length: 25 }, (_item, index) => ({
      id: index + 1,
      template: 'shipped',
      sentAt: null,
      payload: { to: 'ana@example.com', subject: 's', text: 't', html: '<p>t</p>' }
    }));
    const { mailer, sendMail } = buildMailer({
      listResendable: jest.fn().mockResolvedValue(rows)
    });

    await mailer.resendUnsent();

    expect(sendMail).toHaveBeenCalledTimes(20);
  });

  test('sends each subscription letter once and skips when the email is missing', async () => {
    const { mailer, sendMail, claimMailSend } = buildMailer();
    const invoice = { id: 'in_9', amount_paid: 18900, currency: 'brl', customer_email: 'ana@example.com' };
    const cycleLedger = { ...ledger, currentPeriodEnd: '2026-10-16 12:00:00', planLabel: 'Fresh Bowl' };

    await mailer.notifyRenewal({ invoice, ledger: cycleLedger, subscriptionId: 'sub_123', referenceId: 'in_9' });
    await mailer.notifyPaused({ ledger: cycleLedger, subscriptionId: 'sub_123', referenceId: 'paused:evt_1' });
    await mailer.notifyResumed({ ledger: cycleLedger, subscriptionId: 'sub_123', referenceId: 'resumed:evt_2' });
    await mailer.notifyCancelled({ ledger: cycleLedger, subscriptionId: 'sub_123', referenceId: 'deleted', endsAt: '2026-10-16 12:00:00' });
    await mailer.notifyPlanChanged({ invoice, ledger: cycleLedger, subscriptionId: 'sub_123', referenceId: 'plan:in_9' });

    expect(sendMail).toHaveBeenCalledTimes(5);
    for (const call of sendMail.mock.calls) {
      expect(call[0].to).toBe('ana@example.com');
      expect(call[0].subject).toBeTruthy();
      expect(call[0].text).toBeTruthy();
      expect(call[0].html).toContain('Eden Bowls');
    }
    expect(claimMailSend.mock.calls.map((call) => call[0].template)).toEqual([
      'renewal',
      'paused',
      'resumed',
      'cancelled',
      'plan_changed'
    ]);

    sendMail.mockClear();
    await expect(mailer.notifyRenewal({
      invoice: { id: 'in_9' },
      ledger: { address: { country: 'BR' } },
      subscriptionId: 'sub_123',
      referenceId: 'in_9'
    })).resolves.toMatchObject({ skipped: true, reason: 'missing_context' });
    await expect(mailer.notifyPaused({
      ledger: { stripeSubscriptionId: 'sub_123' },
      subscriptionId: 'sub_123',
      referenceId: 'paused:evt_1'
    })).resolves.toMatchObject({ skipped: true, reason: 'missing_context' });
    await expect(mailer.notifyResumed({
      ledger: cycleLedger,
      subscriptionId: 'sub_123'
    })).resolves.toMatchObject({ skipped: true, reason: 'missing_context' });
    await expect(mailer.notifyCancelled({
      ledger: { address: { country: 'US' } },
      referenceId: 'deleted'
    })).resolves.toMatchObject({ skipped: true, reason: 'missing_context' });
    await expect(mailer.notifyPlanChanged({
      ledger: { ...cycleLedger, customerEmail: '' },
      subscriptionId: 'sub_123',
      referenceId: 'plan:in_9'
    })).resolves.toMatchObject({ skipped: true, reason: 'missing_context' });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
