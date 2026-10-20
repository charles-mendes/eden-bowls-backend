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
    expect(previews).toHaveLength(16);
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
      roles: ['veterinarian'],
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
      roles: ['veterinarian'],
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

describe('stage-change email (customer-life-stage-notice)', () => {
  const {
    buildLifeStageChangeEmail,
    firstEditableDeadline,
    formatDeadline,
    packsUrl
  } = require('../src/core/email/life-stage-emails');

  // BR deliveries charged on 2026-10-27 and 2026-11-10: cutoffs at 23:59:59 of the day before, Brasília time.
  const brDeliveries = [
    { editableUntil: '2026-10-27T02:59:59.000Z' },
    { editableUntil: '2026-11-10T02:59:59.000Z' }
  ];

  function brEmailAt(now) {
    const deadline = firstEditableDeadline(brDeliveries, new Date(now));
    return buildLifeStageChangeEmail({
      firstName: 'Ana',
      petName: 'Thor',
      stage: 'senior',
      suggestedRecipes: ['Receita de Carne para Cães Sênior'],
      adjustUrl: packsUrl('https://edenbowls.com', 'sub_1', 'p-thor'),
      deadlineLabel: formatDeadline(deadline, 'BR'),
      locale: 'pt-BR'
    });
  }

  test('pt-BR: no article before the name, the stage, a link to Ajustar packs of that plan', () => {
    const email = brEmailAt('2026-10-19T12:00:00Z');
    expect(email.subject).toBe('Thor está entrando na fase Sênior');
    expect(email.text).toContain('Pela idade informada, Thor está entrando na fase Sênior.');
    expect(email.text).not.toMatch(/\bo Thor\b/);
    expect(email.html).toContain('https://edenbowls.com/dashboard/plans/sub_1/packs?pet=p-thor');
    expect(email.html).toContain('Ajustar packs');
    expect(email.html).toContain('Receita de Carne para Cães Sênior');
  });

  test('en-US: "Based on the age you gave, Luna is entering the Senior stage."', () => {
    const deadline = firstEditableDeadline([{ editableUntil: '2026-10-27T03:59:59.000Z' }], new Date('2026-10-20T12:00:00Z'));
    const email = buildLifeStageChangeEmail({
      firstName: 'Ana',
      petName: 'Luna',
      stage: 'senior',
      adjustUrl: packsUrl('https://edenbowls.com', 'sub_2', 'p-luna'),
      deadlineLabel: formatDeadline(deadline, 'US'),
      locale: 'en-US'
    });
    expect(email.text).toContain('Based on the age you gave, Luna is entering the Senior stage.');
    expect(email.text).toContain('Adjust by: Monday, October 26, at 11:59 PM ET');
    expect(email.html).toContain('Adjust packs');
    expect(email.html).toContain('/dashboard/plans/sub_2/packs?pet=p-luna');
  });

  test('sent 7 days before the next cutoff: shows that delivery\'s editable_until in Brasília time', () => {
    const email = brEmailAt('2026-10-20T03:00:00Z');
    expect(email.text).toContain('Ajuste até: segunda-feira, 26 de outubro, às 23h59 (horário de Brasília)');
  });

  test('sent 2 days before the next cutoff: still that delivery\'s editable_until', () => {
    const email = brEmailAt('2026-10-25T03:00:00Z');
    expect(email.text).toContain('Ajuste até: segunda-feira, 26 de outubro, às 23h59 (horário de Brasília)');
  });

  test('sent after the next cutoff: shows the following delivery\'s editable_until', () => {
    const email = brEmailAt('2026-10-27T03:00:00Z');
    expect(email.text).toContain('Ajuste até: segunda-feira, 9 de novembro, às 23h59 (horário de Brasília)');
  });

  test('the preview catalog has the stage-change letter in both locales', () => {
    const pt = listEmailPreviews({ locale: 'pt-BR' }).find((item) => item.id === 'life-stage-change');
    const en = listEmailPreviews({ locale: 'en-US' }).find((item) => item.id === 'life-stage-change');
    expect(pt.content.text).toContain('Pela idade informada, Thor está entrando na fase Sênior.');
    expect(en.content.text).toContain('Based on the age you gave, Luna is entering the Senior stage.');
  });
});

describe('recipe names in customer emails (2.15)', () => {
  const { createTransactionalMailer } = require('../src/infrastructure/mailers/transactional-mailer');
  const NAMES = {
    BR: { beef: { label: 'Bovino' }, 'senior-beef': { label: 'Receita de Carne para Cães Sênior', shortLabel: 'Bovino · Sênior' } },
    US: { beef: { label: 'Beef' }, 'senior-beef': { label: 'Beef Recipe for Senior Dogs', shortLabel: 'Beef · Senior' } }
  };

  function mailerWith(recipeNamesRepository) {
    const otpMailer = { sendMail: jest.fn(async () => ({})) };
    const claimsRepository = { claimMailSend: jest.fn(async () => ({ claimed: true, id: 1 })), markSent: jest.fn() };
    return { otpMailer, mailer: createTransactionalMailer({ otpMailer, claimsRepository, recipeNamesRepository }) };
  }

  function ledger(account) {
    return {
      stripeSubscriptionId: 'sub_1',
      stripeAccount: account,
      customerEmail: 'ana@example.com',
      address: { name: 'Ana Mendes', country: account === 'br' ? 'BR' : 'US' },
      planSelection: { pets: [{ pet_id: 'p-thor', pet_name: 'Thor', selected_flavors: ['senior-beef', 'beef'] }] }
    };
  }

  test.each([
    ['br', 'Receita de Carne para Cães Sênior', 'Bovino'],
    ['us', 'Beef Recipe for Senior Dogs', 'Beef']
  ])('%s order confirmation prints the full catalog names', async (account, full, adult) => {
    const { mailer, otpMailer } = mailerWith({ listRecipeNames: async () => NAMES });
    await mailer.notifyOrderConfirmed({ invoice: { id: 'in_1', amount_paid: 1000, currency: account === 'br' ? 'brl' : 'usd' }, ledger: ledger(account), subscriptionId: 'sub_1' });
    const payload = otpMailer.sendMail.mock.calls[0][0];
    expect(payload.html).toContain(full);
    expect(payload.html).toContain(adult);
    expect(payload.html).not.toContain('senior-beef');
  });

  test('when the catalog cannot be read, the email prints the keys', async () => {
    const { mailer, otpMailer } = mailerWith({ listRecipeNames: async () => { throw new Error('db down'); } });
    await mailer.notifyRenewal({ invoice: { id: 'in_2', amount_paid: 1000, currency: 'brl' }, ledger: ledger('br'), subscriptionId: 'sub_1' });
    expect(otpMailer.sendMail.mock.calls[0][0].html).toContain('senior-beef');
  });
});
