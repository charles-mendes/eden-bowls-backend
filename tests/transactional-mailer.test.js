const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');

function buildMailer(overrides = {}) {
  const sendMail = overrides.sendMail || jest.fn().mockResolvedValue({ skipped: false });
  const claimMailSend = overrides.claimMailSend || jest.fn().mockResolvedValue({ claimed: true, id: 1 });
  const markSent = overrides.markSent || jest.fn().mockResolvedValue(undefined);
  const mailer = createTransactionalMailer({
    otpMailer: { sendMail },
    claimsRepository: { claimMailSend, markSent },
    storeAppUrl: 'http://localhost:5173',
    adminAppUrl: 'http://localhost:5174',
    opsEmails: overrides.opsEmails === undefined ? ['ops@edenbowls.com'] : overrides.opsEmails,
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  });
  return { mailer, sendMail, claimMailSend, markSent };
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

  test('does not mark sent when SMTP throws after claim', async () => {
    const sendMail = jest.fn().mockRejectedValue({ code: 'EENVELOPE' });
    const { mailer, markSent } = buildMailer({ sendMail });

    await expect(mailer.notifyOrderConfirmed({
      invoice: { id: 'in_1', amount_paid: 1000, currency: 'usd' },
      ledger,
      subscriptionId: 'sub_123'
    })).resolves.toMatchObject({ failed: true, claimed: true });

    expect(markSent).not.toHaveBeenCalled();
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
});
