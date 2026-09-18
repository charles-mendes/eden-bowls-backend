const { buildInviteEmailContent } = require('../src/core/invite-email');
const { buildPrivacyEmailContent } = require('../src/core/privacy-email');
const {
  buildOrderConfirmedEmail,
  buildPasswordResetEmail,
  buildPaymentFailedEmail,
  buildShippedEmail
} = require('../src/core/email/transactional-emails');
const { listEmailPreviews } = require('../src/core/email/preview-fixtures');
const { createInviteMailer } = require('../src/infrastructure/mailers/invite-mailer');
const { createPrivacyMailer } = require('../src/infrastructure/mailers/privacy-mailer');

describe('transactional email catalog', () => {
  test('builds the P0 customer letters with brand shell and plaintext', () => {
    const confirmed = buildOrderConfirmedEmail({
      firstName: 'Ana',
      petName: 'Luna',
      flavors: ['Bovino', 'Peru'],
      planName: 'Fresh Bowl',
      totalLabel: 'R$ 189,00',
      dashboardUrl: 'https://edenbowls.com/dashboard/plans'
    });
    const failed = buildPaymentFailedEmail({
      firstName: 'Ana',
      petName: 'Luna',
      amountLabel: 'R$ 189,00',
      updatePaymentUrl: 'https://edenbowls.com/dashboard/plans'
    });
    const shipped = buildShippedEmail({
      firstName: 'Ana',
      petName: 'Luna',
      trackingNumber: '1Z999',
      trackingUrl: 'https://www.ups.com/track?tracknum=1Z999'
    });
    const reset = buildPasswordResetEmail({
      firstName: 'Ana',
      resetUrl: 'https://edenbowls.com/reset-password?token=abc'
    });

    expect(confirmed.subject).toContain('Luna');
    expect(confirmed.html).toContain('Bovino');
    expect(confirmed.html).not.toContain('#7f54b3');
    expect(failed.html).toContain('Atualizar pagamento');
    expect(shipped.html).toContain('1Z999');
    expect(reset.text).toContain('https://edenbowls.com/reset-password?token=abc');
  });

  test('escapes HTML in customer-facing fields', () => {
    const content = buildOrderConfirmedEmail({
      firstName: '<script>x</script>',
      petName: 'Luna',
      dashboardUrl: 'https://edenbowls.com/dashboard/plans'
    });
    expect(content.html).not.toContain('<script>x</script>');
    expect(content.html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  test('lists every preview fixture with subject, text and html', () => {
    const previews = listEmailPreviews();
    expect(previews).toHaveLength(13);
    for (const item of previews) {
      expect(item.content.subject).toBeTruthy();
      expect(item.content.text).toBeTruthy();
      expect(item.content.html).toContain('Eden Bowls');
      expect(item.content.html).toContain('#F5EFE2');
    }
  });
});

describe('staff invite and privacy HTML', () => {
  test('keeps English invite copy by default', () => {
    const content = buildInviteEmailContent({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      temporaryPassword: 'TempPassword#12345',
      roles: ['nutritionist'],
      panelUrl: 'http://localhost:5174',
      expiresAt: 1_700_000_000
    });

    expect(content.subject).toBe('Your Eden Bowls admin access');
    expect(content.html).toContain('TempPassword#12345');
  });

  test('sends invite HTML through the SMTP mailer', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const mailer = createInviteMailer({ otpMailer: { sendMail } });

    await mailer.sendInviteEmail({
      to: 'lia@edenbowls.com',
      name: 'Lia',
      temporaryPassword: 'TempPassword#12345',
      roles: ['operator'],
      panelUrl: 'http://localhost:5174',
      expiresAt: 1_700_000_000
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining('TempPassword#12345')
    }));
  });

  test('sends privacy identity HTML in Portuguese', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const mailer = createPrivacyMailer({
      otpMailer: { sendMail },
      nodeEnv: 'development'
    });

    await mailer.sendIdentityVerificationEmail({
      to: 'ana@example.com',
      confirmUrl: 'https://example.com/confirm',
      locale: 'pt-BR'
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Eden Bowls — confirme sua identidade',
      html: expect.stringContaining('https://example.com/confirm')
    }));
    expect(buildPrivacyEmailContent({
      confirmUrl: 'https://example.com/confirm',
      locale: 'pt-BR'
    }).text).toContain('pedido de privacidade');
  });
});
