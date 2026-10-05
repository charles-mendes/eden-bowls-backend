const { buildInviteEmailContent } = require('../src/core/invite-email');
const { buildPrivacyEmailContent } = require('../src/core/privacy-email');
const {
  buildCancelledEmail,
  buildOrderConfirmedEmail,
  buildPasswordResetEmail,
  buildPausedEmail,
  buildPaymentFailedEmail,
  buildPlanChangedEmail,
  buildRenewalEmail,
  buildResumedEmail,
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
    expect(reset.html).toContain('/reset-password?token=abc');
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
    expect(previews).toHaveLength(14);
    for (const item of previews) {
      expect(item.content.subject).toBeTruthy();
      expect(item.content.text).toBeTruthy();
      expect(item.content.html).toContain('Eden Bowls');
      expect(item.content.html).toContain('#F5EFE2');
    }
  });
});

describe('designer email shell', () => {
  test('uses https logos after stripping a trailing slash, and omits images otherwise', () => {
    const https = buildOrderConfirmedEmail({
      petName: 'Luna',
      assetBaseUrl: 'https://api.example.com/'
    });
    expect(https.html).toContain('src="https://api.example.com/email/logo-circle@2x.png"');
    expect(https.html).toContain('src="https://api.example.com/email/logo-horizontal@2x.png"');
    expect(https.html).toContain('alt="Eden Bowls"');
    expect(https.html).not.toContain('https://api.example.com//');
    expect(https.html).toContain('E-mail automático da Eden Bowls');
    expect(https.html).toContain('hello@edenbowls.com');

    const http = buildOrderConfirmedEmail({
      petName: 'Luna',
      assetBaseUrl: 'http://api.example.com'
    });
    expect(http.html).not.toContain('<img');
    expect(http.html).toContain('Eden Bowls');

    const empty = buildOrderConfirmedEmail({ petName: 'Luna', locale: 'en-US' });
    expect(empty.html).not.toContain('<img');
    expect(empty.html).toContain('Automated email from Eden Bowls');
  });

  test('puts the pet name only in the letters that use it, and keeps frequency in months', () => {
    const confirmed = buildOrderConfirmedEmail({
      firstName: 'Ana',
      petName: 'Luna',
      cycleLabel: 'A cada 3 meses',
      totalLabel: 'R$ 189,00',
      locale: 'pt-BR'
    });
    expect(confirmed.subject).toBe('A tigela da Luna entrou na cozinha');
    expect(confirmed.text).toContain('A cada 3 meses');
    expect(confirmed.text).toContain('R$ 189,00');
    expect(confirmed.text).not.toContain('14 dias');
    expect(confirmed.text).not.toContain('A chave da cozinha');

    const english = buildOrderConfirmedEmail({
      petName: 'Luna',
      cycleLabel: 'Every 3 months',
      locale: 'en-US'
    });
    expect(english.subject).toBe("Luna's bowl is in the kitchen");

    const invite = buildInviteEmailContent({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      temporaryPassword: 'TempPassword#12345',
      roles: ['nutritionist'],
      panelUrl: 'http://localhost:5174',
      expiresAt: 1_700_000_000,
      locale: 'pt-BR'
    });
    expect(invite.subject).toBe('Seu acesso ao painel da Eden Bowls');
    expect(invite.subject).not.toContain('Lia');
    expect(invite.html).not.toContain('A mesa dos bastidores');
  });

  test('shows a paused resume date only when the builder receives one', () => {
    const missing = buildPausedEmail({ petName: 'Luna', locale: 'pt-BR' });
    expect(missing.html).not.toContain('Retomada prevista');

    const present = buildPausedEmail({
      petName: 'Luna',
      resumeAtLabel: '16 out 2026',
      locale: 'pt-BR'
    });
    expect(present.html).toContain('Retomada prevista');
    expect(present.html).toContain('16 out 2026');
  });

  test('builds renewal, pause, resume, cancel, and plan change in pt-BR and en-US', () => {
    const shared = {
      firstName: 'Ana',
      petName: 'Luna',
      flavors: ['Bovino'],
      planName: 'Fresh Bowl',
      totalLabel: 'R$ 189,00',
      nextDeliveryLabel: '16 de out. de 2026',
      resumeAtLabel: '16 de out. de 2026',
      endsAtLabel: '16 de out. de 2026',
      dashboardUrl: 'https://edenbowls.com/dashboard/plans'
    };
    const letters = [
      {
        build: buildRenewalEmail,
        ptSubject: 'Mais um ciclo na cozinha: recibo da Luna',
        enSubject: "Another cycle in the kitchen: Luna's receipt",
        ptFact: 'Valor cobrado',
        enFact: 'Amount charged'
      },
      {
        build: buildPausedEmail,
        ptSubject: 'A tigela da Luna está pausada',
        enSubject: "Luna's bowl is paused",
        ptFact: 'Retomada prevista',
        enFact: 'Scheduled to resume'
      },
      {
        build: buildResumedEmail,
        ptSubject: 'A Luna está de volta à cozinha',
        enSubject: 'Luna is back in the kitchen',
        ptFact: 'Próxima entrega',
        enFact: 'Next delivery'
      },
      {
        build: buildCancelledEmail,
        ptSubject: 'A assinatura da Luna foi encerrada',
        enSubject: "Luna's subscription has been cancelled",
        ptFact: 'Válida até',
        enFact: 'Active until'
      },
      {
        build: buildPlanChangedEmail,
        ptSubject: 'O cardápio da Luna mudou',
        enSubject: "Luna's menu has changed",
        ptFact: 'Fresh Bowl',
        enFact: 'Fresh Bowl'
      }
    ];

    for (const letter of letters) {
      const portuguese = letter.build({ ...shared, locale: 'pt-BR' });
      const english = letter.build({ ...shared, locale: 'en-US' });

      expect(portuguese.subject).toBe(letter.ptSubject);
      expect(portuguese.text).toContain(letter.ptFact);
      expect(portuguese.html).toContain('Eden Bowls');
      expect(portuguese.html).toContain(letter.ptFact === 'Fresh Bowl' ? 'Fresh Bowl' : letter.ptFact);

      expect(english.subject).toBe(letter.enSubject);
      expect(english.text).toContain(letter.enFact);
      expect(english.html).toContain('Eden Bowls');
      expect(english.html).toContain('Automated email from Eden Bowls');
      expect(english.subject).not.toBe(portuguese.subject);
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

    expect(content.subject).toBe('Your access to the Eden Bowls dashboard');
    expect(content.subject).not.toContain('Lia');
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
      subject: 'Confirme sua identidade para continuar',
      html: expect.stringContaining('https://example.com/confirm')
    }));
    expect(buildPrivacyEmailContent({
      confirmUrl: 'https://example.com/confirm',
      locale: 'pt-BR'
    }).text).toContain('pedido relacionado aos dados');
  });
});
