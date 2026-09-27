const { buildOtpEmailContent } = require('../otp-email');
const { buildInviteEmailContent } = require('../invite-email');
const { buildPrivacyEmailContent } = require('../privacy-email');
const {
  buildAdminNewSubscriptionEmail,
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
      id: 'plan-changed',
      group: 'P1 · ciclo',
      label: 'Mudança de plano',
      wired: false,
      content: buildPlanChangedEmail({ ...sample, ...shell })
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
        roles: ['nutritionist'],
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
