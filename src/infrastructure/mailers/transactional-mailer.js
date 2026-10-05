const { DateTime } = require('luxon');
const { withTimeout } = require('../../core/with-timeout');
const {
  buildAdminNewSubscriptionEmail,
  buildAutoRenewOffEmail,
  buildCancelledEmail,
  buildOrderConfirmedEmail,
  buildPausedEmail,
  buildPaymentFailedEmail,
  buildPlanChangedEmail,
  buildRenewalEmail,
  buildResumedEmail,
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
  shipped: 'shipped',
  renewal: 'renewal',
  paused: 'paused',
  resumed: 'resumed',
  cancelled: 'cancelled',
  autoRenewOff: 'auto_renew_off',
  planChanged: 'plan_changed'
};

const RESEND_TEMPLATES = [
  TEMPLATES.orderConfirmed,
  TEMPLATES.adminNewSubscription,
  TEMPLATES.paymentFailed,
  TEMPLATES.shipped
];
const RESEND_BATCH = 20;
const RESEND_MIN_AGE_MS = 2 * 60 * 1000;
const SMTP_TIMEOUT_MS = 20 * 1000;
const SEND_ATTEMPTS = 3;
const SEND_RETRY_DELAY_MS = 100;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function formatLetterDate(value, locale) {
  if (value == null || value === '') {
    return '';
  }
  const zone = locale === 'pt-BR' ? 'America/Sao_Paulo' : 'America/New_York';
  const loc = locale === 'pt-BR' ? 'pt-BR' : 'en-US';
  let date = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1e12 ? value * 1000 : value;
    date = DateTime.fromMillis(millis, { zone });
  } else if (value instanceof Date) {
    date = DateTime.fromJSDate(value, { zone });
  } else {
    const text = String(value).trim();
    if (!text) {
      return '';
    }
    date = DateTime.fromISO(text, { zone });
    if (!date.isValid) {
      date = DateTime.fromSQL(text, { zone });
    }
  }
  if (!date || !date.isValid) {
    return '';
  }
  return date.setLocale(loc).toLocaleString(DateTime.DATE_MED);
}

function createTransactionalMailer(options = {}) {
  const logger = options.logger || { error() {}, warn() {}, info() {} };
  const otpMailer = options.otpMailer || null;
  const claimsRepository = options.claimsRepository || null;
  const storeAppUrl = options.storeAppUrl || 'http://localhost:5173';
  const emailAssetBaseUrl = options.emailAssetBaseUrl || '';
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

  function missingContext(template) {
    logger.warn({ template, reason: 'missing_context' }, 'Transactional email skipped.');
    return { skipped: true, reason: 'missing_context' };
  }

  function logSmtpFailure(template, subscriptionId, error) {
    logger.error({
      template,
      subscriptionId,
      code: error && error.code ? error.code : 'smtp_failed'
    }, 'Transactional email failed.');
  }

  async function releaseClaim(claimId) {
    if (!claimsRepository || typeof claimsRepository.releaseUnsent !== 'function') {
      return;
    }
    try {
      await claimsRepository.releaseUnsent(claimId);
    } catch (error) {
      logger.error({
        claimId,
        code: error && error.code ? error.code : 'release_failed'
      }, 'Mail claim release failed.');
    }
  }

  async function sendWithRetries(payload) {
    let lastError = null;
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
      try {
        return await withTimeout(otpMailer.sendMail(payload), SMTP_TIMEOUT_MS);
      } catch (error) {
        lastError = error;
        if (attempt < SEND_ATTEMPTS) {
          await wait(SEND_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError;
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
      await rememberPayload(claim.id, {
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html
      });
      const result = await sendWithRetries({
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
      await releaseClaim(claim.id);
      logSmtpFailure(template, subscriptionId, error);
      return { skipped: false, failed: true, claimed: false };
    }
  }

  async function notifyOrderConfirmed({ invoice = {}, ledger = {}, subscriptionId }) {
    const id = String(subscriptionId || ledger.stripeSubscriptionId || '').trim();
    const invoiceId = String(invoice.id || '').trim();
    const to = String(ledger.customerEmail || invoice.customer_email || '').trim();
    if (!id || !invoiceId || !to) {
      return missingContext(TEMPLATES.orderConfirmed);
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
      locale,
      assetBaseUrl: emailAssetBaseUrl
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
      return missingContext(TEMPLATES.adminNewSubscription);
    }

    const locale = localeFrom(ledger);
    const content = buildAdminNewSubscriptionEmail({
      customerName: firstNameFrom(ledger) || ledger.customerEmail,
      customerEmail: ledger.customerEmail || invoice.customer_email,
      petName: petNameFrom(ledger),
      planName: ledger.planLabel || '',
      totalLabel: formatMoney(invoice.amount_paid || invoice.total, invoice.currency),
      adminUrl: joinPath(adminAppUrl, ''),
      locale,
      assetBaseUrl: emailAssetBaseUrl
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
      await rememberPayload(claim.id, {
        recipients: opsEmails,
        subject: content.subject,
        text: content.text,
        html: content.html
      });
      let lastError = null;
      for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
        try {
          for (const to of opsEmails) {
            const result = await withTimeout(otpMailer.sendMail({
              to,
              subject: content.subject,
              text: content.text,
              html: content.html
            }), SMTP_TIMEOUT_MS);
            if (result && result.skipped === true) {
              throw Object.assign(new Error('smtp_skipped'), { code: 'smtp_skipped' });
            }
          }
          await claimsRepository.markSent(claim.id);
          return { skipped: false, claimed: true };
        } catch (error) {
          lastError = error;
          if (attempt < SEND_ATTEMPTS) {
            await wait(SEND_RETRY_DELAY_MS);
          }
        }
      }
      await releaseClaim(claim.id);
      logSmtpFailure(TEMPLATES.adminNewSubscription, id, lastError);
      return { skipped: false, failed: true, claimed: false };
    } catch (error) {
      await releaseClaim(claim.id);
      logSmtpFailure(TEMPLATES.adminNewSubscription, id, error);
      return { skipped: false, failed: true, claimed: false };
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
      return missingContext(TEMPLATES.paymentFailed);
    }

    const amount = object.amount_due || object.amount || object.total;
    const content = buildPaymentFailedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      amountLabel: formatMoney(amount, object.currency),
      updatePaymentUrl: dashboardPlansUrl(storeAppUrl),
      locale: localeFrom(ledger),
      assetBaseUrl: emailAssetBaseUrl
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
      return missingContext(TEMPLATES.shipped);
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
      locale: localeFrom(source),
      assetBaseUrl: emailAssetBaseUrl
    });

    return sendClaimed({
      subscriptionId: id,
      template: TEMPLATES.shipped,
      referenceId,
      to,
      content
    });
  }

  function customerTarget({ ledger = {}, subscriptionId, referenceId, fallbackEmail }) {
    return {
      id: String(subscriptionId || ledger.stripeSubscriptionId || '').trim(),
      reference: String(referenceId || '').trim(),
      to: String(ledger.customerEmail || fallbackEmail || '').trim()
    };
  }

  async function notifyRenewal({ invoice = {}, ledger = {}, subscriptionId, referenceId }) {
    const target = customerTarget({
      ledger,
      subscriptionId,
      referenceId: referenceId || invoice.id,
      fallbackEmail: invoice.customer_email
    });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.renewal);
    }
    const locale = localeFrom(ledger);
    const content = buildRenewalEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      flavors: flavorsFrom(ledger),
      totalLabel: formatMoney(invoice.amount_paid || invoice.total, invoice.currency),
      nextDeliveryLabel: formatLetterDate(ledger.currentPeriodEnd, locale),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.renewal,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  async function notifyPaused({ ledger = {}, subscriptionId, referenceId, resumeAt }) {
    const target = customerTarget({ ledger, subscriptionId, referenceId });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.paused);
    }
    const locale = localeFrom(ledger);
    const content = buildPausedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      resumeAtLabel: formatLetterDate(resumeAt, locale),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.paused,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  async function notifyResumed({ ledger = {}, subscriptionId, referenceId }) {
    const target = customerTarget({ ledger, subscriptionId, referenceId });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.resumed);
    }
    const locale = localeFrom(ledger);
    const content = buildResumedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      nextDeliveryLabel: formatLetterDate(ledger.currentPeriodEnd, locale),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.resumed,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  async function notifyCancelled({ ledger = {}, subscriptionId, referenceId, endsAt }) {
    const target = customerTarget({ ledger, subscriptionId, referenceId });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.cancelled);
    }
    const locale = localeFrom(ledger);
    const content = buildCancelledEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      endsAtLabel: formatLetterDate(endsAt || ledger.currentPeriodEnd, locale),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.cancelled,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  // `endsOn` is the last contracted delivery date (YYYY-MM-DD) from the deliveries read.
  async function notifyAutoRenewOff({ ledger = {}, subscriptionId, referenceId, endsOn }) {
    const target = customerTarget({ ledger, subscriptionId, referenceId });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.autoRenewOff);
    }
    const locale = localeFrom(ledger);
    const content = buildAutoRenewOffEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      endsOnLabel: formatLetterDate(endsOn, locale),
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.autoRenewOff,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  async function notifyPlanChanged({ invoice = {}, ledger = {}, subscriptionId, referenceId }) {
    const target = customerTarget({
      ledger,
      subscriptionId,
      referenceId,
      fallbackEmail: invoice.customer_email
    });
    if (!target.id || !target.reference || !target.to) {
      return missingContext(TEMPLATES.planChanged);
    }
    const locale = localeFrom(ledger);
    const amount = invoice.amount_paid || invoice.total;
    const content = buildPlanChangedEmail({
      firstName: firstNameFrom(ledger),
      petName: petNameFrom(ledger),
      planName: ledger.planLabel || '',
      flavors: flavorsFrom(ledger),
      totalLabel: amount ? formatMoney(amount, invoice.currency) : '',
      dashboardUrl: dashboardPlansUrl(storeAppUrl),
      locale,
      assetBaseUrl: emailAssetBaseUrl
    });
    return sendClaimed({
      subscriptionId: target.id,
      template: TEMPLATES.planChanged,
      referenceId: target.reference,
      to: target.to,
      content
    });
  }

  async function hasSentClaim({ subscriptionId, template }) {
    if (!claimsRepository || typeof claimsRepository.hasSentClaim !== 'function') {
      return false;
    }
    return Boolean(await claimsRepository.hasSentClaim({ subscriptionId, template }));
  }

  async function resendUnsent({ now = new Date(), limit = RESEND_BATCH } = {}) {
    if (!claimsRepository || typeof claimsRepository.listResendable !== 'function' || !otpMailer) {
      return { scanned: 0, sent: 0, failed: 0, exhausted: 0 };
    }

    const olderThan = new Date(now.getTime() - RESEND_MIN_AGE_MS);
    const rows = await claimsRepository.listResendable({
      olderThan,
      limit,
      templates: RESEND_TEMPLATES
    });
    const batch = rows.filter((row) => !row.sentAt).slice(0, RESEND_BATCH);
    let sent = 0;
    let failed = 0;
    let exhausted = 0;

    for (const row of batch) {
      try {
        await deliverStored(row);
        await claimsRepository.markSent(row.id);
        sent += 1;
      } catch (error) {
        const failure = await recordClaimFailure(row.id, error);
        logSendFailure(row.template, row.id, failure);
        if (failure.exhausted) {
          exhausted += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { scanned: batch.length, sent, failed, exhausted };
  }

  async function deliverStored(row) {
    const payload = row.payload;
    if (!payload) {
      throw new Error('missing_payload');
    }
    const recipients = Array.isArray(payload.recipients) && payload.recipients.length
      ? payload.recipients
      : [payload.to];
    for (const to of recipients) {
      if (!to) {
        throw new Error('missing_recipient');
      }
      await withTimeout(otpMailer.sendMail({
        to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html
      }), SMTP_TIMEOUT_MS);
    }
  }

  async function rememberPayload(claimId, payload) {
    if (claimsRepository && typeof claimsRepository.savePayload === 'function') {
      await claimsRepository.savePayload(claimId, payload);
    }
  }

  async function recordClaimFailure(claimId, error) {
    if (!claimsRepository || typeof claimsRepository.recordSendFailure !== 'function') {
      return { attempts: 0, exhausted: false };
    }
    return claimsRepository.recordSendFailure(claimId, error);
  }

  function logSendFailure(template, claimId, failure) {
    if (failure && failure.exhausted) {
      logger.info({ template, claimId, outcome: 'exhausted' }, 'Transactional email exhausted.');
      return;
    }
    logger.error({ template, claimId, outcome: 'failed' }, 'Transactional email failed.');
  }

  return {
    notifyOrderConfirmed,
    notifyAdminNewSubscription,
    notifyPaymentFailed,
    notifyShipped,
    notifyRenewal,
    notifyPaused,
    notifyResumed,
    notifyCancelled,
    notifyAutoRenewOff,
    notifyPlanChanged,
    hasSentClaim,
    sendClaimed,
    resendUnsent
  };
}

module.exports = {
  TEMPLATES,
  RESEND_TEMPLATES,
  RESEND_BATCH,
  createTransactionalMailer
};
