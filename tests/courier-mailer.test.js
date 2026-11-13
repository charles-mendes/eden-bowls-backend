const { createTransactionalMailer, RESEND_TEMPLATES, TEMPLATES } = require('../src/infrastructure/mailers/transactional-mailer');

function buildMailer({ claimMailSend } = {}) {
  const sendMail = jest.fn().mockResolvedValue({ skipped: false });
  const claims = {
    claimMailSend: claimMailSend || jest.fn().mockResolvedValue({ claimed: true, id: 1 }),
    markSent: jest.fn(), savePayload: jest.fn(), recordSendFailure: jest.fn().mockResolvedValue({ attempts: 1 }),
    releaseUnsent: jest.fn(), listResendable: jest.fn().mockResolvedValue([])
  };
  const mailer = createTransactionalMailer({
    otpMailer: { sendMail },
    claimsRepository: claims,
    storeAppUrl: 'http://localhost:5173',
    adminAppUrl: 'http://localhost:5174',
    opsEmails: [],
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  });
  return { mailer, sendMail, claims };
}

// A gift: the account holder is Ana, the box goes to João.
const subscription = {
  stripeSubscriptionId: 'sub_br_1',
  stripeAccount: 'br',
  user: { email: 'ana@example.com' },
  address: { name: 'Ana Costa', recipient_name: 'João Lima', country: 'BR' },
  petsSnapshot: { pets_names: ['Luna'] }
};

describe('courier letters', () => {
  test('Dispatch with a link: pt-BR letter with the link, claimed by the courier row', async () => {
    const { mailer, sendMail, claims } = buildMailer();
    await mailer.notifyCourierOutForDelivery({ subscription, delivery: { id: 12, tracking_url: 'https://trip.uber.com/abc123' } });

    expect(claims.claimMailSend).toHaveBeenCalledWith({ subscriptionId: 'sub_br_1', template: 'courier_out_for_delivery', referenceId: '12' });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ana@example.com');
    expect(mail.subject).toBe('A tigela da Luna saiu para entrega');
    expect(mail.html).toContain('https://trip.uber.com/abc123');
    expect(mail.html).toContain('Oi, Ana.');
    expect(mail.html).not.toContain('João');
  });

  test('Second attempt claims a new reference, so it sends again', async () => {
    const { mailer, sendMail, claims } = buildMailer();
    await mailer.notifyCourierOutForDelivery({ subscription, delivery: { id: 12 } });
    await mailer.notifyCourierOutForDelivery({ subscription, delivery: { id: 13 } });
    expect(claims.claimMailSend.mock.calls.map(([claim]) => claim.referenceId)).toEqual(['12', '13']);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  test('Delivered is sent once per row', async () => {
    const claimMailSend = jest.fn().mockResolvedValueOnce({ claimed: true, id: 3 }).mockResolvedValueOnce({ claimed: false });
    const { mailer, sendMail } = buildMailer({ claimMailSend });
    await mailer.notifyCourierDelivered({ subscription, delivery: { id: 12 } });
    await mailer.notifyCourierDelivered({ subscription, delivery: { id: 12 } });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].subject).toBe('A tigela da Luna foi entregue');
    expect(sendMail.mock.calls[0][0].html).not.toContain('João');
  });

  test('neither courier template is resent by the job', () => {
    expect(TEMPLATES.courierOutForDelivery).toBe('courier_out_for_delivery');
    expect(RESEND_TEMPLATES).not.toContain('courier_out_for_delivery');
    expect(RESEND_TEMPLATES).not.toContain('courier_delivered');
  });

  test('a missing email skips the letter', async () => {
    const { mailer, sendMail } = buildMailer();
    await expect(mailer.notifyCourierDelivered({ subscription: { ...subscription, user: {} }, delivery: { id: 12 } }))
      .resolves.toMatchObject({ skipped: true });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
