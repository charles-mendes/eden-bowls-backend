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

function listEmailPreviews() {
  return [
    {
      id: 'otp',
      group: 'P0 · conta',
      label: 'OTP de cadastro',
      wired: true,
      content: buildOtpEmailContent({ otp: '847291', expiresInSeconds: 900, locale: 'pt-BR' })
    },
    {
      id: 'password-reset',
      group: 'P0 · conta',
      label: 'Reset de senha',
      wired: false,
      content: buildPasswordResetEmail({
        firstName: SAMPLE.firstName,
        resetUrl: SAMPLE.resetUrl,
        locale: 'pt-BR'
      })
    },
    {
      id: 'order-confirmed',
      group: 'P0 · pedido',
      label: 'Assinatura confirmada',
      wired: false,
      content: buildOrderConfirmedEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'payment-failed',
      group: 'P0 · pedido',
      label: 'Falha de pagamento',
      wired: false,
      content: buildPaymentFailedEmail({ ...SAMPLE, amountLabel: SAMPLE.totalLabel, locale: 'pt-BR' })
    },
    {
      id: 'shipped',
      group: 'P0 · pedido',
      label: 'Enviado com rastreio',
      wired: false,
      content: buildShippedEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'admin-new-subscription',
      group: 'P0 · operação',
      label: 'Admin · nova assinatura',
      wired: false,
      content: buildAdminNewSubscriptionEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'renewal',
      group: 'P1 · ciclo',
      label: 'Recibo de renovação',
      wired: false,
      content: buildRenewalEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'paused',
      group: 'P1 · ciclo',
      label: 'Pausa',
      wired: false,
      content: buildPausedEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'resumed',
      group: 'P1 · ciclo',
      label: 'Retomada',
      wired: false,
      content: buildResumedEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'cancelled',
      group: 'P1 · ciclo',
      label: 'Cancelamento',
      wired: false,
      content: buildCancelledEmail({ ...SAMPLE, locale: 'pt-BR' })
    },
    {
      id: 'plan-changed',
      group: 'P1 · ciclo',
      label: 'Mudança de plano',
      wired: false,
      content: buildPlanChangedEmail({ ...SAMPLE, locale: 'pt-BR' })
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
        locale: 'pt-BR'
      })
    },
    {
      id: 'privacy',
      group: 'P1 · staff',
      label: 'Verificação de privacidade',
      wired: true,
      content: buildPrivacyEmailContent({
        confirmUrl: SAMPLE.confirmUrl,
        locale: 'pt-BR'
      })
    }
  ];
}

module.exports = {
  SAMPLE,
  listEmailPreviews
};
