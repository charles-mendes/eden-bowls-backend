const { buildDeliveryAddressIssueEmail } = require('../src/core/email/transactional-emails');
const { createTransactionalMailer, RESEND_TEMPLATES, TEMPLATES } = require('../src/infrastructure/mailers/transactional-mailer');

function buildMailer({ claimMailSend, sendMail } = {}) {
  const send = sendMail || jest.fn().mockResolvedValue({ skipped: false });
  const claims = {
    claimMailSend: claimMailSend || jest.fn().mockResolvedValue({ claimed: true, id: 1 }),
    markSent: jest.fn(), savePayload: jest.fn(), recordSendFailure: jest.fn().mockResolvedValue({ attempts: 1 }),
    releaseUnsent: jest.fn(), listResendable: jest.fn().mockResolvedValue([])
  };
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const mailer = createTransactionalMailer({
    otpMailer: { sendMail: send },
    claimsRepository: claims,
    storeAppUrl: 'https://loja.example',
    adminAppUrl: 'https://admin.example',
    opsEmails: [],
    logger,
    wait: async () => {}
  });
  return { mailer, sendMail: send, claims, logger };
}

const subscription = {
  stripeSubscriptionId: 'sub_br_1',
  stripeAccount: 'br',
  customerEmail: 'ana@example.com',
  address: { name: 'Ana Costa', country: 'BR' }
};
const issue = { id: 41, codes: ['address_neighborhood_missing', 'fiscal_name_missing'] };

describe('deliveryAddressIssue template', () => {
  test('pt-BR: one paragraph per code and the link to the address step', () => {
    const url = 'https://loja.example/dashboard/plans/sub_br_1/edit?step=address';
    const mail = buildDeliveryAddressIssueEmail({ firstName: 'Ana', codes: issue.codes, editUrl: url, locale: 'pt-BR' });
    expect(mail.subject).toBe('Precisamos de um dado para enviar sua tigela');
    expect(mail.text).toContain('Falta o bairro no endereço de entrega.');
    expect(mail.text).toContain('Falta o nome completo para a nota fiscal.');
    expect(mail.text).toContain(url);
    expect(mail.html).toContain('step=address');
    expect((mail.html.match(/Falta o/g) || []).length).toBe(2);
  });

  test('en-US for the US account, and an unknown code prints nothing', () => {
    const mail = buildDeliveryAddressIssueEmail({ codes: ['po_box_not_allowed', 'nope'], editUrl: 'https://x/edit?step=address', locale: 'en-US' });
    expect(mail.subject).toBe('We need one detail to ship your bowl');
    expect(mail.text).toContain('We cannot deliver to a PO box.');
    expect(mail.text).not.toContain('nope');
  });
});

describe('notifyDeliveryAddressIssue', () => {
  test('claims by the problem id and links to the subscription address step, in the account language', async () => {
    const { mailer, sendMail, claims } = buildMailer();
    const result = await mailer.notifyDeliveryAddressIssue({ issue, subscription: { ...subscription, address: { country: 'US' } } });
    expect(result).toMatchObject({ claimed: true, skipped: false });
    expect(claims.claimMailSend).toHaveBeenCalledWith({ subscriptionId: 'sub_br_1', template: 'delivery_address_issue', referenceId: '41' });
    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe('ana@example.com');
    expect(mail.subject).toBe('Precisamos de um dado para enviar sua tigela');
    expect(mail.text).toContain('https://loja.example/dashboard/plans/sub_br_1/edit?step=address');
  });

  test('a second call for the same problem is a duplicate', async () => {
    const claimMailSend = jest.fn().mockResolvedValueOnce({ claimed: true, id: 3 }).mockResolvedValueOnce({ claimed: false });
    const { mailer, sendMail } = buildMailer({ claimMailSend });
    await mailer.notifyDeliveryAddressIssue({ issue, subscription });
    expect(await mailer.notifyDeliveryAddressIssue({ issue, subscription })).toEqual({ skipped: true, reason: 'duplicate' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test('an SMTP failure is reported as failed, and the template is never resent by a job', async () => {
    const { mailer } = buildMailer({ sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) });
    expect(await mailer.notifyDeliveryAddressIssue({ issue, subscription })).toMatchObject({ failed: true, claimed: false });
    expect(RESEND_TEMPLATES).not.toContain(TEMPLATES.deliveryAddressIssue);
  });
});
