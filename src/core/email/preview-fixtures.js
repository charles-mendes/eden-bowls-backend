const { buildOtpEmailContent } = require('../otp-email');
const { buildInviteEmailContent } = require('../invite-email');
const { buildPrivacyEmailContent } = require('../privacy-email');
const {
  buildAdminNewSubscriptionEmail,
  buildAutoRenewOffEmail,
  buildCancelledEmail,
  buildOrderConfirmedEmail,
  buildPasswordResetEmail,
  buildPausedEmail,
  buildPaymentFailedEmail,
  buildPlanChangedEmail,
  buildRenewalEmail,
  buildResumedEmail,
  buildShippedEmail
} = require('./transactional-emails');
const { companyAddressFromProfile, formatCompanyAddress } = require('./company-address');
const { COMPANY_PROFILE_SEED } = require('../company-profile');
const {
  buildLifeStageAnnouncementEmail,
  buildLifeStageChangeEmail,
  formatDeadline,
  packsUrl
} = require('./life-stage-emails');

const SAMPLE = {
  firstName: 'Ana',
  petName: 'Luna',
  flavors: ['Bovino', 'Peru'],
  planName: 'Fresh Bowl · 14 dias',
  cycleLabel: 'A cada 14 dias',
  totalLabel: 'R$ 189,00',
  dashboardUrl: 'https://edenbowls.com/dashboard/plans',
  updatePaymentUrl: 'https://edenbowls.com/dashboard/plans',
  resetUrl: 'https://edenbowls.com/reset-password?token=preview',
  trackingNumber: '1Z999AA10123456784',
  carrier: 'UPS',
  trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
  nextDeliveryLabel: '02 out 2026',
  resumeAtLabel: '16 out 2026',
  endsAtLabel: '30 set 2026',
  customerName: 'Ana Mendes',
  customerEmail: 'ana@example.com',
  adminUrl: 'http://localhost:5174/customers',
  panelUrl: 'http://localhost:5174',
  confirmUrl: 'https://api.edenbowls.com/api/v1/privacy/identity-confirm?token=preview'
};

function listEmailPreviews(options = {}) {
  const locale = options.locale || 'pt-BR';
  const en = String(locale).toLowerCase().startsWith('en');
  const shell = {
    locale,
    assetBaseUrl: options.assetBaseUrl,
    allowRelativeAssets: options.allowRelativeAssets
  };
  const sample = en
    ? {
      ...SAMPLE,
      flavors: ['Beef', 'Turkey'],
      planName: 'Fresh Bowl · 14 days',
      cycleLabel: 'Every 14 days',
      totalLabel: '$189.00',
      nextDeliveryLabel: 'Oct 2, 2026',
      resumeAtLabel: 'Oct 16, 2026',
      endsAtLabel: 'Sep 30, 2026'
    }
    : SAMPLE;
  return [
    {
      id: 'otp',
      group: 'P0 · conta',
      label: 'OTP de cadastro',
      wired: true,
      content: buildOtpEmailContent({ otp: '847291', expiresInSeconds: 900, ...shell })
    },
    {
      id: 'password-reset',
      group: 'P0 · conta',
      label: 'Reset de senha',
      wired: false,
      content: buildPasswordResetEmail({
        firstName: sample.firstName,
        resetUrl: sample.resetUrl,
        ...shell
      })
    },
    {
      id: 'order-confirmed',
      group: 'P0 · pedido',
      label: 'Assinatura confirmada',
      wired: true,
      content: buildOrderConfirmedEmail({ ...sample, ...shell })
    },
    {
      id: 'payment-failed',
      group: 'P0 · pedido',
      label: 'Falha de pagamento',
      wired: true,
      content: buildPaymentFailedEmail({ ...sample, amountLabel: sample.totalLabel, ...shell })
    },
    {
      id: 'shipped',
      group: 'P0 · pedido',
      label: 'Enviado com rastreio',
      wired: true,
      content: buildShippedEmail({ ...sample, ...shell })
    },
    {
      id: 'admin-new-subscription',
      group: 'P0 · operação',
      label: 'Admin · nova assinatura',
      wired: true,
      content: buildAdminNewSubscriptionEmail({ ...sample, ...shell })
    },
    {
      id: 'renewal',
      group: 'P1 · ciclo',
      label: 'Recibo de renovação',
      wired: false,
      content: buildRenewalEmail({ ...sample, ...shell })
    },
    {
      id: 'paused',
      group: 'P1 · ciclo',
      label: 'Pausa',
      wired: false,
      content: buildPausedEmail({ ...sample, ...shell })
    },
    {
      id: 'resumed',
      group: 'P1 · ciclo',
      label: 'Retomada',
      wired: false,
      content: buildResumedEmail({ ...sample, ...shell })
    },
    {
      id: 'cancelled',
      group: 'P1 · ciclo',
      label: 'Cancelamento',
      wired: false,
      content: buildCancelledEmail({ ...sample, ...shell })
    },
    {
      id: 'auto-renew-off',
      group: 'P1 · ciclo',
      label: 'Renovação automática desligada',
      wired: true,
      content: buildAutoRenewOffEmail({ ...sample, endsOnLabel: sample.endsAtLabel, ...shell })
    },
    {
      id: 'plan-changed',
      group: 'P1 · ciclo',
      label: 'Mudança de plano',
      wired: false,
      content: buildPlanChangedEmail({ ...sample, ...shell })
    },
    {
      id: 'life-stage-change',
      group: 'P1 · fase da vida',
      label: 'Mudança de fase do pet',
      wired: false,
      content: en
        ? buildLifeStageChangeEmail({
          firstName: 'Ana',
          petName: 'Luna',
          stage: 'senior',
          suggestedRecipes: ['Beef Recipe for Senior Dogs', 'Chicken Recipe for Senior Dogs'],
          adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_luna'),
          deadlineLabel: formatDeadline('2026-10-27T03:59:59Z', 'US'),
          ...shell
        })
        : buildLifeStageChangeEmail({
          firstName: 'Ana',
          petName: 'Thor',
          stage: 'senior',
          suggestedRecipes: ['Receita de Carne para Cães Sênior', 'Receita de Frango para Cães Sênior'],
          adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_thor'),
          deadlineLabel: formatDeadline('2026-10-27T02:59:59Z', 'BR'),
          ...shell
        })
    },
    {
      id: 'life-stage-announcement',
      group: 'P1 · fase da vida',
      label: 'Anúncio das receitas por fase (marketing)',
      wired: false,
      content: buildLifeStageAnnouncementEmail({
        firstName: 'Ana',
        profileUrl: 'https://edenbowls.com/dashboard/profile',
        companyLine: en
          ? formatCompanyAddress('US', companyAddressFromProfile(COMPANY_PROFILE_SEED.US))
          : formatCompanyAddress('BR', companyAddressFromProfile(COMPANY_PROFILE_SEED.BR)),
        dogs: en
          ? [
            { petName: 'Luna', stage: 'puppy', recipes: ['Chicken & Pork Recipe for Puppies', 'Beef & Chicken Recipe for Puppies'], adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_luna') },
            { petName: 'Thor', stage: 'senior', recipes: ['Beef Recipe for Senior Dogs', 'Chicken Recipe for Senior Dogs'], adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_thor') }
          ]
          : [
            { petName: 'Luna', stage: 'puppy', recipes: ['Receita de Frango e Porco para Filhotes', 'Receita de Carne e Frango para Filhotes'], adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_luna') },
            { petName: 'Thor', stage: 'senior', recipes: ['Receita de Carne para Cães Sênior', 'Receita de Frango para Cães Sênior'], adjustUrl: packsUrl('https://edenbowls.com', 'sub_preview', 'pet_thor') }
          ],
        ...shell
      })
    },
    {
      id: 'invite',
      group: 'P1 · staff',
      label: 'Convite admin',
      wired: true,
      content: buildInviteEmailContent({
        name: 'Lia',
        email: 'lia@edenbowls.com',
        temporaryPassword: 'TempPassword#12345',
        roles: ['veterinarian'],
        panelUrl: SAMPLE.panelUrl,
        expiresAt: 1_700_000_000,
        ...shell
      })
    },
    {
      id: 'privacy',
      group: 'P1 · staff',
      label: 'Verificação de privacidade',
      wired: true,
      content: buildPrivacyEmailContent({
        confirmUrl: SAMPLE.confirmUrl,
        ...shell
      })
    }
  ];
}

module.exports = {
  SAMPLE,
  listEmailPreviews
};
