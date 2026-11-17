const { buildPlanEndingNoticeEmail, buildRenewalNoticeEmail } = require('../src/core/email/transactional-emails');
const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');

function mailerWith({ sendMail = jest.fn().mockResolvedValue({}), claim = { claimed: true, id: 1 } } = {}) {
  const claims = {
    claimMailSend: jest.fn().mockResolvedValue(claim),
    markSent: jest.fn(),
    savePayload: jest.fn(),
    releaseUnsent: jest.fn()
  };
  return { sendMail, claims, mailer: createTransactionalMailer({ otpMailer: { sendMail }, claimsRepository: claims }) };
}

const ledger = { customerEmail: 'ana@example.com', address: { country: 'BR' }, stripeAccount: 'br' };

describe('plan notice letters', () => {
  test('Brazilian subscription', () => {
    const letter = buildRenewalNoticeEmail({ petName: 'Luna', renewsOnLabel: '9 de nov. de 2026', totalLabel: 'R$ 89,90', locale: 'pt-BR' });
    expect(letter.subject).toBe('Seu plano renova em 9 de nov. de 2026');
    expect(letter.text).toContain('Valor: R$ 89,90');
  });

  test('renewal notice without an amount leaves the row out', () => {
    const letter = buildRenewalNoticeEmail({ petName: 'Luna', renewsOnLabel: 'Nov 9, 2026', locale: 'en-US' });
    expect(letter.subject).toBe('Your plan renews on Nov 9, 2026');
    expect(letter.text).not.toContain('Amount');
    expect(letter.html).not.toContain('Amount');
  });

  test('plan ending notice states the end date and how to keep the plan', () => {
    const letter = buildPlanEndingNoticeEmail({ petName: 'Luna', endsOnLabel: 'Nov 9, 2026', locale: 'en-US' });
    expect(letter.subject).toBe('Your plan ends on Nov 9, 2026');
    expect(letter.text).toContain('turn renewal back on');
  });
});

describe('plan notice mailer', () => {
  test('Preview succeeds: the renewal notice shows the amount in the market format', async () => {
    const { mailer, sendMail, claims } = mailerWith();
    await mailer.notifyRenewalNotice({
      ledger,
      subscriptionId: 'sub_1',
      referenceId: 'renewal_notice:1',
      renewsOn: new Date('2026-11-09T12:00:00.000Z'),
      total: { amount: 8990, currency: 'brl' }
    });
    expect(claims.claimMailSend.mock.calls[0][0]).toMatchObject({ template: 'renewal_notice', referenceId: 'renewal_notice:1' });
    expect(sendMail.mock.calls[0][0].text).toContain('R$ 89,90');
  });

  test('the letter date uses the market time zone', async () => {
    const { mailer, sendMail } = mailerWith();
    await mailer.notifyPlanEndingNotice({
      ledger,
      subscriptionId: 'sub_1',
      referenceId: 'plan_ending_notice:1',
      endsOn: new Date('2026-11-10T01:00:00.000Z')
    });
    expect(sendMail.mock.calls[0][0].subject).toMatch(/^Seu plano termina em 9 de nov/);
  });

  test('Next tick after a send: a duplicate reference does not call SMTP', async () => {
    const { mailer, sendMail } = mailerWith({ claim: { claimed: false } });
    const result = await mailer.notifyPlanEndingNotice({ ledger, subscriptionId: 'sub_1', referenceId: 'plan_ending_notice:1', endsOn: new Date() });
    expect(result).toMatchObject({ skipped: true, reason: 'duplicate' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('SMTP fails: returns failed and releases the claim', async () => {
    const { mailer, claims } = mailerWith({ sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) });
    const result = await mailer.notifyRenewalNotice({ ledger, subscriptionId: 'sub_1', referenceId: 'renewal_notice:1', renewsOn: new Date() });
    expect(result).toMatchObject({ failed: true });
    expect(claims.releaseUnsent).toHaveBeenCalledWith(1);
  }, 20000);
});
