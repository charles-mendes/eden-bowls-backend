const {
  buildAdminNewSubscriptionEmail,
  buildOrderConfirmedEmail,
  buildPaymentFailedEmail,
  buildShippedEmail
} = require('../../core/email/transactional-emails');
const {
  dashboardPlansUrl,
  firstNameFrom,
  flavorsFrom,
  formatMoney,
  joinPath,
  localeFrom,
  petNameFrom
} = require('../../core/email/mail-context');

const TEMPLATES = {
  orderConfirmed: 'order_confirmed',
  adminNewSubscription: 'admin_new_subscription',
  paymentFailed: 'payment_failed',
  shipped: 'shipped'
};

function createTransactionalMailer(options = {}) {
  const logger = options.logger || { error() {}, warn() {}, info() {} };
  const otpMailer = options.otpMailer || null;
  const claimsRepository = options.claimsRepository || null;
  const storeAppUrl = options.storeAppUrl || 'http://localhost:5173';
  const adminAppUrl = options.adminAppUrl || 'http://localhost:5174';
  const opsEmails = Array.isArray(options.opsEmails) ? options.opsEmails.filter(Boolean) : [];

  function canSend() {
    return Boolean(
      otpMailer
      && typeof otpMailer.sendMail === 'function'
      && claimsRepository
      && typeof claimsRepository.claimMailSend === 'function'
    );
  }

  async function sendClaimed({ subscriptionId, template, referenceId, to, content }) {
    if (!canSend()) {
      return { skipped: true, reason: 'mailer_unavailable' };
    }

    const recipient = String(to || '').trim();
    if (!recipient || !content) {
      return { skipped: true, reason: 'missing_recipient' };
    }

    let claim;
    try {
      claim = await claimsRepository.claimMailSend({
        subscriptionId,
        template,
        referenceId
      });
    } catch (error) {
      logger.error({
        template,
        code: error && error.code
      }, 'Mail claim failed.');
      return { skipped: true, reason: 'claim_failed' };
    }

    if (!claim || !claim.claimed) {
      return { skipped: true, reason: 'duplicate' };
    }

    try {
      const result = await otpMailer.sendMail({
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html
      });
      if (!result || result.skipped !== true) {
        await claimsRepository.markSent(claim.id);
      }
      return { skipped: Boolean(result && result.skipped), claimed: true };
    } catch (error) {
      logger.error({
        to: recipient,
        subject: content.subject,
        template,
        code: error && error.code
      }, 'Transactional email failed.');
      return { skipped: false, failed: true, claimed: true };
    }
  }

  async function notifyOrderConfirmed({ invoice = {}, ledger = {}, subscriptionId }) {
    const id = String(subscriptionId || ledger.stripeSubscriptionId || '').trim();
    const invoiceId = String(invoice.id || '').trim();
    const to = String(ledger.customerEmail || invoice.customer_email || '').trim();
    if (!id || !invoiceId || !to) {
      return { skipped: true, reason: 'missing_context' };
    }

    const locale = localeFrom(ledger);
    const content = buildOrderConfirmedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      flavors: flavorsFrom(ledger),
      planName: ledger.planLabel || '',
      cycleLabel: ledger.subscriptionTermMonths
        ? (localeFrom(ledger) === 'pt-BR'
          ? `A cada ${ledger.subscriptionTermMonths} meses`
          : `Every ${ledger.subscriptionTermMonths} months`)
        : '',
      totalLabel: formatMoney(invoice.amount_paid || invoice.total, invoice.currency),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale
    });

    return sendClaimed({
      subscriptionId: id,
      template: TEMPLATES.orderConfirmed,
      referenceId: invoiceId,
      to,
      content
    });
  }

  async function notifyAdminNewSubscription({ invoice = {}, ledger = {}, subscriptionId }) {
    if (opsEmails.length === 0) {
      return { skipped: true, reason: 'no_ops_recipients' };
    }

    const id = String(subscriptionId || ledger.stripeSubscriptionId || '').trim();
    const invoiceId = String(invoice.id || '').trim();
    if (!id || !invoiceId) {
      return { skipped: true, reason: 'missing_context' };
    }

    const locale = localeFrom(ledger);
    const content = buildAdminNewSubscriptionEmail({
      customerName: firstNameFrom(ledger) || ledger.customerEmail,
      customerEmail: ledger.customerEmail || invoice.customer_email,
      petName: petNameFrom(ledger),
      planName: ledger.planLabel || '',
      totalLabel: formatMoney(invoice.amount_paid || invoice.total, invoice.currency),
      adminUrl: joinPath(adminAppUrl, ''),
      locale
    });

    if (!canSend()) {
      return { skipped: true, reason: 'mailer_unavailable' };
    }

    let claim;
    try {
      claim = await claimsRepository.claimMailSend({
        subscriptionId: id,
        template: TEMPLATES.adminNewSubscription,
        referenceId: invoiceId
      });
    } catch (error) {
      logger.error({
        template: TEMPLATES.adminNewSubscription,
        code: error && error.code
      }, 'Mail claim failed.');
      return { skipped: true, reason: 'claim_failed' };
    }

    if (!claim || !claim.claimed) {
      return { skipped: true, reason: 'duplicate' };
    }

    try {
      let delivered = false;
      for (const to of opsEmails) {
        const result = await otpMailer.sendMail({
          to,
          subject: content.subject,
          text: content.text,
          html: content.html
        });
        if (!result || result.skipped !== true) {
          delivered = true;
        }
      }
      if (delivered) {
        await claimsRepository.markSent(claim.id);
      }
      return { skipped: !delivered, claimed: true };
    } catch (error) {
      logger.error({
        subject: content.subject,
        template: TEMPLATES.adminNewSubscription,
        code: error && error.code
      }, 'Transactional email failed.');
      return { skipped: false, failed: true, claimed: true };
    }
  }

  async function notifyPaymentFailed({ object = {}, ledger = {}, subscriptionId }) {
    const id = String(subscriptionId || ledger.stripeSubscriptionId || '').trim();
    const paymentIntentId = object.payment_intent && typeof object.payment_intent === 'object'
      ? object.payment_intent.id
      : object.payment_intent;
    const referenceId = String(object.id || paymentIntentId || '').trim();
    const to = String(ledger.customerEmail || object.customer_email || '').trim();
    if (!id || !referenceId || !to) {
      return { skipped: true, reason: 'missing_context' };
    }

    const amount = object.amount_due || object.amount || object.total;
    const content = buildPaymentFailedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      amountLabel: formatMoney(amount, object.currency),
      updatePaymentUrl: dashboardPlansUrl(storeAppUrl),
      locale: localeFrom(ledger)
    });

    return sendClaimed({
      subscriptionId: id,
      template: TEMPLATES.paymentFailed,
      referenceId,
      to,
      content
    });
  }

  async function notifyShipped({ subscription = {}, shipment = {} }) {
    const id = String(
      subscription.stripeSubscriptionId
      || subscription.providerSubscriptionId
      || shipment.subscription_id
      || ''
    ).trim();
    const referenceId = String(shipment.id || '').trim();
    const to = String((subscription.user && subscription.user.email) || '').trim();
    const trackingNumber = String(shipment.tracking_number || '').trim();
    if (!id || !referenceId || !to || !trackingNumber) {
      return { skipped: true, reason: 'missing_context' };
    }

    const source = {
      ...subscription,
      petsSnapshot: subscription.petsSnapshot,
      planSelection: subscription.planSelection,
      address: subscription.address,
      stripeAccount: subscription.stripeAccount
    };
    const content = buildShippedEmail({
      firstName: firstNameFrom(source),
      petName: petNameFrom(source),
      trackingNumber,
      carrier: 'UPS',
      trackingUrl: `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`,
      locale: localeFrom(source)
    });

    return sendClaimed({
      subscriptionId: id,
      template: TEMPLATES.shipped,
      referenceId,
      to,
      content
    });
  }

  return {
    notifyOrderConfirmed,
    notifyAdminNewSubscription,
    notifyPaymentFailed,
    notifyShipped,
    sendClaimed
  };
}

module.exports = {
  TEMPLATES,
  createTransactionalMailer
};
