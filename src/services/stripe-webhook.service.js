const { HttpError } = require('../core/http-error');
const { withTimeout } = require('../core/with-timeout');
const { parseStripeAccountInput } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');
const {
  extractSubscriptionIdFromInvoice,
  extractSubscriptionPeriod,
  mapStripeStatus,
  extractCardFromPaymentMethod
} = require('../core/stripe-subscription-map');
const {
  isChargedDeliveryInvoice,
  lastContractedDeliveryCharged
} = require('../core/contract-deliveries');

const WEBHOOK_EVENT_TIMEOUT_MS = 30 * 1000;
const WEBHOOK_RETRY_BATCH = 20;
const WEBHOOK_RETRY_GAP_MS = 30 * 1000;
const WEBHOOK_MAX_ATTEMPTS = 8;
const WEBHOOK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const HANDLED_TYPES = new Set([
  'invoice.paid',
  'invoice.created',
  'payment_intent.succeeded',
  'payment_intent.processing',
  'payment_intent.payment_failed',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]);

class StripeWebhookService {
  constructor(options = {}) {
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.webhookSecret = options.webhookSecret || '';
    this.eventsRepository = options.eventsRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.customerStore = options.customerStore || null;
    this.shippingProductId = options.shippingProductId || '';
    this.transactionalMailer = options.transactionalMailer || null;
    this.pendingDeliveryChanges = options.pendingDeliveryChanges || null;
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
    this.withTimeout = options.withTimeout || withTimeout;
  }

  async handle({ account, rawBody, signature }) {
    const stripeAccount = parseStripeAccountInput(account, 'us');
    const webhookSecret = this.stripeAccounts
      ? this.stripeAccounts.webhookSecret(stripeAccount)
      : this.webhookSecret;
    const stripeBilling = resolveStripeBilling(this, stripeAccount);

    if (!webhookSecret) {
      const webhookName = stripeAccount === 'br' ? 'STRIPE_BR_WEBHOOK_SECRET' : 'STRIPE_US_WEBHOOK_SECRET';
      throw new HttpError(503, `${webhookName} is not configured.`, {
        code: 'stripe_webhook_secret_missing',
        stripe_account: stripeAccount
      });
    }

    if (!this.eventsRepository || !this.ledgerRepository) {
      throw new HttpError(503, 'Stripe webhook persistence is not available.');
    }

    const event = stripeBilling.constructEvent(rawBody, signature, webhookSecret);
    this.logger.info({
      stripe_account: stripeAccount,
      eventId: event.id,
      type: event.type
    }, 'Stripe webhook received.');

    const inserted = await this.eventsRepository.insertIfNew({
      eventId: event.id,
      stripeAccount,
      type: event.type,
      payloadSummary: this.summarize(event)
    });

    if (!inserted.inserted) {
      return { received: true };
    }

    const pending = {
      eventId: event.id,
      stripeAccount,
      attempts: 0,
      createdAt: new Date()
    };

    if (!HANDLED_TYPES.has(event.type)) {
      await this.eventsRepository.markProcessed({ eventId: event.id, stripeAccount });
      return { received: true };
    }

    const runtime = {
      account: stripeAccount,
      stripeBilling,
      shippingProductId: stripeBilling.shippingProductId || this.shippingProductId || ''
    };

    try {
      await this.dispatch(event, runtime);
      await this.eventsRepository.markProcessed({ eventId: event.id, stripeAccount });
    } catch (error) {
      await this.noteFailure(pending, error);
      this.logger.error({
        err: error,
        eventId: event.id,
        type: event.type,
        stripe_account: stripeAccount
      }, 'Stripe webhook processing failed after persist.');
    }

    return { received: true };
  }

  async retryPending(options = {}) {
    if (!this.eventsRepository || typeof this.eventsRepository.listDue !== 'function') {
      return { scanned: 0, succeeded: 0, failed: 0 };
    }

    const timeoutMs = options.timeoutMs || WEBHOOK_EVENT_TIMEOUT_MS;
    const rows = await this.eventsRepository.listDue({
      limit: options.limit || WEBHOOK_RETRY_BATCH,
      now: options.now || new Date()
    });
    let succeeded = 0;
    let failed = 0;

    for (const row of rows) {
      const outcome = await this.retryOne(row, timeoutMs);
      if (outcome.ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    }

    return { scanned: rows.length, succeeded, failed };
  }

  async retryOne(row, timeoutMs) {
    try {
      await this.withTimeout(this.redeliver(row), timeoutMs);
      await this.eventsRepository.markProcessed({
        eventId: row.eventId,
        stripeAccount: row.stripeAccount
      });
      return { ok: true };
    } catch (error) {
      if (error && error.code === 'stripe_event_missing') {
        await this.eventsRepository.markFailed({
          eventId: row.eventId,
          stripeAccount: row.stripeAccount,
          attempts: Number(row.attempts || 0),
          lastError: 'stripe_event_missing'
        });
        return { ok: false, terminal: true };
      }
      await this.noteFailure(row, error);
      return { ok: false };
    }
  }

  async redeliver(row) {
    const stripeBilling = resolveStripeBilling(this, row.stripeAccount);
    const event = await stripeBilling.retrieveEvent(row.eventId);
    if (!event) {
      const missing = new Error('Stripe event is missing.');
      missing.code = 'stripe_event_missing';
      throw missing;
    }
    await this.dispatch(event, {
      account: row.stripeAccount,
      stripeBilling,
      shippingProductId: stripeBilling.shippingProductId || this.shippingProductId || ''
    });
  }

  async noteFailure(row, error, now = new Date()) {
    const attempts = Number(row.attempts || 0) + 1;
    const createdAt = row.createdAt ? new Date(row.createdAt) : now;
    const expired = now.getTime() - createdAt.getTime() >= WEBHOOK_MAX_AGE_MS;
    const lastError = String(error && error.message ? error.message : 'dispatch_failed').slice(0, 500);
    if (attempts >= WEBHOOK_MAX_ATTEMPTS || expired) {
      await this.eventsRepository.markFailed({
        eventId: row.eventId,
        stripeAccount: row.stripeAccount,
        attempts,
        lastError
      });
      return;
    }
    await this.eventsRepository.scheduleRetry({
      eventId: row.eventId,
      stripeAccount: row.stripeAccount,
      attempts,
      lastError,
      nextAttemptAt: new Date(now.getTime() + WEBHOOK_RETRY_GAP_MS)
    });
  }

  summarize(event) {
    const object = event && event.data && event.data.object ? event.data.object : {};
    return {
      type: event.type,
      object_id: object.id || null,
      customer: object.customer || null,
      subscription: extractSubscriptionIdFromInvoice(object) || object.id || null
    };
  }

  async dispatch(event, runtime) {
    const object = event.data && event.data.object ? event.data.object : {};
    if (event.type === 'invoice.paid') {
      await this.handleInvoicePaid(object, runtime, event);
      return;
    }
    if (event.type === 'invoice.created') {
      await this.handleInvoiceCreated(object, runtime);
      return;
    }
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.processing') {
      const marker = this.edenEnvValue(object.metadata);
      if (marker && marker !== this.edenEnvLabel()) {
        this.warnIgnored(event, 'marker_mismatch', { stripe_account: runtime.account });
        return;
      }
      await this.handlePaymentIntentUpdate(object);
      return;
    }
    if (event.type === 'payment_intent.payment_failed') {
      await this.handlePaymentFailed(object, event.type, { sendMail: false });
      return;
    }
    if (event.type === 'invoice.payment_failed') {
      await this.handlePaymentFailed(object, event.type, { sendMail: true });
      return;
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const marker = this.edenEnvValue(object.metadata);
      if (!marker || marker !== this.edenEnvLabel()) {
        this.warnIgnored(event, marker ? 'marker_mismatch' : 'marker_missing', {
          stripe_account: runtime.account
        });
        return;
      }
      await this.handleSubscriptionChanged(object, runtime, event);
    }
  }

  async resolveUserContext({ subscriptionId, customerId, metadataUserId }) {
    if (subscriptionId) {
      const ledger = await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId);
      if (ledger) {
        return { userId: ledger.userId, ledger };
      }
      const state = await this.ledgerRepository.findUserStateBySubscriptionId(subscriptionId);
      if (state) {
        return { userId: state.userId, ledger: null, checkoutReference: state.checkoutReference };
      }
    }

    if (customerId && this.customerStore && this.customerStore.findUserIdByCustomerId) {
      const userId = await this.customerStore.findUserIdByCustomerId(customerId);
      if (userId) {
        return { userId, ledger: null };
      }
    }

    const fromMeta = Number(metadataUserId);
    if (Number.isSafeInteger(fromMeta) && fromMeta > 0) {
      return { userId: fromMeta, ledger: null };
    }

    return { userId: null, ledger: null };
  }

  async retrieveSubscriptionSafe(subscriptionId, stripeBilling) {
    const billing = stripeBilling || this.stripeBilling;
    if (!subscriptionId || !billing || !billing.retrieveSubscription) {
      return null;
    }
    try {
      return await billing.retrieveSubscription(subscriptionId);
    } catch (_error) {
      return null;
    }
  }

  cardFromSubscription(subscription) {
    const paymentMethod = subscription && subscription.default_payment_method
      && typeof subscription.default_payment_method === 'object'
      ? subscription.default_payment_method
      : null;
    return extractCardFromPaymentMethod(paymentMethod);
  }

  edenEnvLabel() {
    return String(process.env.EDEN_RUNTIME || '').trim();
  }

  warnIgnored(event, reason, extra = {}) {
    this.logger.warn({
      type: event && event.type,
      eventId: event && event.id,
      stripe_account: extra.stripe_account,
      reason
    }, 'Stripe webhook ignored.');
  }

  edenEnvValue(metadata) {
    if (!metadata || typeof metadata !== 'object') {
      return '';
    }
    return String(metadata.eden_env || '').trim();
  }

  async handleInvoicePaid(invoice, runtime = {}, event = {}) {
    const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
    const subscription = await this.retrieveSubscriptionSafe(subscriptionId, runtime.stripeBilling);
    const subscriptionMeta = subscription && subscription.metadata ? subscription.metadata : null;
    const detailMeta = invoice.subscription_details && invoice.subscription_details.metadata
      ? invoice.subscription_details.metadata
      : null;
    const edenEnv = this.edenEnvValue(subscriptionMeta) || this.edenEnvValue(detailMeta);
    const runtimeLabel = this.edenEnvLabel();
    if (!edenEnv || edenEnv !== runtimeLabel) {
      this.warnIgnored(event, edenEnv ? 'marker_mismatch' : 'marker_missing', {
        stripe_account: runtime.account
      });
      return;
    }
    const metadata = subscriptionMeta || detailMeta || {};
    const context = await this.resolveUserContext({
      subscriptionId,
      customerId: invoice.customer,
      metadataUserId: metadata.wp_user_id || metadata.user_id
    });

    if (!context.userId || !subscriptionId) {
      this.logger.warn({
        invoiceId: invoice.id,
        subscriptionId,
        stripe_account: runtime.account
      }, 'invoice.paid skipped: user not resolved.');
      return;
    }

    const period = extractSubscriptionPeriod(subscription || {});
    const card = this.cardFromSubscription(subscription);
    const item = subscription && subscription.items && Array.isArray(subscription.items.data)
      ? subscription.items.data[0]
      : null;
    const existing = context.ledger || await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId);
    const promotedPending = existing
      && existing.editPaymentPending
      && existing.editPending
      && existing.editPending.invoice_id
      && existing.editPending.invoice_id === invoice.id;

    await this.ledgerRepository.upsert({
      userId: context.userId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: String(invoice.customer || (subscription && subscription.customer) || existing && existing.stripeCustomerId || ''),
      stripeAccount: runtime.account || (existing && existing.stripeAccount) || 'us',
      // A skip or a postponement pays a $0 invoice while the charge waits in trial.
      status: subscription && subscription.status === 'trialing' ? 'trialing' : 'active',
      stripePriceId: item && item.price && item.price.id ? item.price.id : undefined,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: Boolean(subscription && subscription.cancel_at_period_end),
      paymentMethodLast4: card.last4 || undefined,
      paymentMethodBrand: card.brand || undefined,
      ...(promotedPending ? {
        planSelection: existing.editPending.plan_selection || existing.planSelection,
        shipping: existing.editPending.shipping || existing.shipping,
        subscriptionTermMonths: existing.editPending.term_months || existing.subscriptionTermMonths,
        editPaymentPending: false,
        editPending: null
      } : {})
    });

    await this.ledgerRepository.updateCheckoutReference(context.userId, {
      payment_state: 'paid',
      stripe_subscription_id: subscriptionId,
      stripe_invoice_id: invoice.id || undefined
    });

    await this.notifyFirstCycleMail({
      invoice,
      subscriptionId,
      promotedPending
    });

    await this.recordChargedDelivery({
      invoice,
      subscriptionId,
      subscription,
      billing: runtime.stripeBilling || this.stripeBilling
    });
  }

  // Throws so the event is retried; the seed and the increment are both safe to repeat.
  async recordChargedDelivery({ invoice, subscriptionId, subscription, billing }) {
    const ledger = this.ledgerRepository;
    if (!invoice.id || !isChargedDeliveryInvoice(invoice)
      || !ledger || typeof ledger.incrementChargedDeliveries !== 'function') {
      return;
    }
    let row = await ledger.findByStripeSubscriptionId(subscriptionId);
    if (!row) {
      return;
    }
    if (row.chargedDeliveries == null) {
      if (!billing || typeof billing.listPaidInvoicesForSubscription !== 'function') {
        throw new Error('Stripe billing cannot list paid invoices to seed the charged deliveries.');
      }
      const paid = await billing.listPaidInvoicesForSubscription(subscriptionId);
      const invoices = paid.some((item) => item.id === invoice.id) ? paid : [...paid, invoice];
      row = await ledger.seedChargedDeliveries(subscriptionId, invoices.filter(isChargedDeliveryInvoice).length, invoice.id);
    } else {
      row = await ledger.incrementChargedDeliveries(subscriptionId, invoice.id);
    }
    await this.endContractAfterLastDelivery(row, subscription, billing);
    if (this.pendingDeliveryChanges) {
      await this.pendingDeliveryChanges.applyAfterCharge({ subscriptionId, subscription, billing });
    }
  }

  async endContractAfterLastDelivery(row, subscription, billing) {
    if (!row || row.autoRenew !== false || row.cancelAtPeriodEnd) {
      return;
    }
    if (subscription && subscription.cancel_at_period_end) {
      return;
    }
    const plan = row.planSelection || {};
    const term = Number(row.subscriptionTermMonths || plan.subscription_term_months || 1) || 1;
    if (!lastContractedDeliveryCharged(row.chargedDeliveries, term)) {
      return;
    }
    if (!billing || typeof billing.setCancelAtPeriodEnd !== 'function') {
      throw new Error('Stripe billing cannot end the contract after its last delivery.');
    }
    await billing.setCancelAtPeriodEnd(row.stripeSubscriptionId, true);
  }

  async notifyFirstCycleMail({ invoice, subscriptionId, promotedPending }) {
    if (!this.transactionalMailer) {
      return;
    }

    try {
      const ledger = await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId) || {};
      if (promotedPending) {
        await this.transactionalMailer.notifyPlanChanged({
          invoice,
          ledger,
          subscriptionId,
          referenceId: String(invoice.id || '')
        });
        return;
      }

      const reason = String(invoice.billing_reason || '');
      if (reason === 'subscription_create') {
        await this.transactionalMailer.notifyOrderConfirmed({ invoice, ledger, subscriptionId });
        await this.transactionalMailer.notifyAdminNewSubscription({ invoice, ledger, subscriptionId });
        return;
      }
      if (reason === 'subscription_cycle') {
        await this.transactionalMailer.notifyRenewal({
          invoice,
          ledger,
          subscriptionId,
          referenceId: String(invoice.id || '')
        });
      }
    } catch (error) {
      this.logger.error({
        invoiceId: invoice && invoice.id,
        subscriptionId,
        code: error && error.code
      }, 'Transactional email failed.');
    }
  }

  async handleInvoiceCreated(invoice, runtime = {}) {
    if (String(invoice.status || '') !== 'draft') {
      return;
    }
    if (String(invoice.billing_reason || '') !== 'subscription_cycle') {
      return;
    }

    const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
    const subscription = await this.retrieveSubscriptionSafe(subscriptionId, runtime.stripeBilling);
    const metadata = (subscription && subscription.metadata) || {};
    let amountMinor = Number(metadata.shipping_amount_minor || 0);
    let currency = metadata.shipping_currency || invoice.currency || 'usd';
    const productId = metadata.shipping_product_id;

    if (!amountMinor && subscriptionId) {
      const ledger = await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId);
      const shipping = ledger && ledger.shipping ? ledger.shipping : {};
      const cost = Number(shipping.cost || shipping.total || 0);
      if (cost > 0) {
        amountMinor = Math.round(cost * 100);
      }
    }

    if (amountMinor <= 0) {
      return;
    }

    if (!productId || !String(productId).startsWith('prod_')) {
      this.logger.warn({
        subscriptionId,
        stripe_account: runtime.account
      }, 'invoice.created skipped shipping: shipping_product_id missing.');
      return;
    }

    const billing = runtime.stripeBilling || this.stripeBilling;
    if (!billing || typeof billing.addShippingInvoiceItem !== 'function') {
      return;
    }

    await billing.addShippingInvoiceItem({
      invoiceId: invoice.id,
      customerId: invoice.customer,
      productId,
      amount: amountMinor,
      currency
    });
  }

  async handlePaymentIntentUpdate(paymentIntent) {
    const paymentIntentId = String(paymentIntent.id || '');
    const status = String(paymentIntent.status || '');
    if (!paymentIntentId.startsWith('pi_')) {
      return;
    }

    const state = await this.ledgerRepository.findUserStateByPaymentIntentId(paymentIntentId);
    if (!state) {
      return;
    }

    await this.ledgerRepository.updateCheckoutReference(state.userId, {
      stripe_payment_intent_id: paymentIntentId,
      stripe_payment_intent_status: status
    });
  }

  async handlePaymentFailed(object, type, options = {}) {
    const paymentIntentId = type === 'invoice.payment_failed'
      ? String(object.payment_intent && object.payment_intent.id ? object.payment_intent.id : object.payment_intent || '')
      : String(object.id || '');
    const subscriptionId = extractSubscriptionIdFromInvoice(object)
      || (typeof object.subscription === 'string' ? object.subscription : '');

    let userId = null;
    if (paymentIntentId.startsWith('pi_')) {
      const state = await this.ledgerRepository.findUserStateByPaymentIntentId(paymentIntentId);
      if (state) {
        userId = state.userId;
      }
    }
    if (!userId && subscriptionId.startsWith('sub_')) {
      const context = await this.resolveUserContext({
        subscriptionId,
        customerId: object.customer
      });
      userId = context.userId;
    }
    if (!userId) {
      return;
    }

    const ledger = subscriptionId.startsWith('sub_')
      ? await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId)
      : null;

    if (options.sendMail !== false) {
      await this.notifyPaymentFailedMail({ object, ledger, subscriptionId });
    }

    if (ledger && ['active', 'trialing'].includes(ledger.status)) {
      return;
    }

    await this.ledgerRepository.updateCheckoutReference(userId, {
      payment_state: 'failed',
      stripe_payment_intent_id: paymentIntentId.startsWith('pi_') ? paymentIntentId : undefined,
      stripe_payment_intent_status: String(object.status || 'canceled')
    });
  }

  async notifyPaymentFailedMail({ object, ledger, subscriptionId }) {
    if (!this.transactionalMailer) {
      return;
    }

    try {
      await this.transactionalMailer.notifyPaymentFailed({
        object,
        ledger: ledger || {},
        subscriptionId
      });
    } catch (error) {
      this.logger.error({
        invoiceId: object && object.id,
        subscriptionId,
        code: error && error.code
      }, 'Transactional email failed.');
    }
  }

  async handleSubscriptionChanged(subscription, runtime = {}, event = {}) {
    const subscriptionId = String(subscription.id || '');
    if (!subscriptionId.startsWith('sub_')) {
      return;
    }

    const metadata = subscription.metadata || {};
    const context = await this.resolveUserContext({
      subscriptionId,
      customerId: subscription.customer,
      metadataUserId: metadata.wp_user_id || metadata.user_id
    });
    if (!context.userId) {
      return;
    }

    const period = extractSubscriptionPeriod(subscription);
    const card = this.cardFromSubscription(subscription);
    const item = subscription.items && Array.isArray(subscription.items.data)
      ? subscription.items.data[0]
      : null;

    await this.ledgerRepository.upsert({
      userId: context.userId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: String(subscription.customer || (context.ledger && context.ledger.stripeCustomerId) || ''),
      stripeAccount: runtime.account || (context.ledger && context.ledger.stripeAccount) || 'us',
      status: mapStripeStatus(subscription),
      stripePriceId: item && item.price && item.price.id ? item.price.id : undefined,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      paymentMethodLast4: card.last4 || undefined,
      paymentMethodBrand: card.brand || undefined
    });

    await this.notifySubscriptionTransition({
      subscription,
      subscriptionId,
      event
    });
  }

  attributeChanged(previous, key) {
    return Boolean(previous) && Object.prototype.hasOwnProperty.call(previous, key);
  }

  async notifySubscriptionTransition({ subscription, subscriptionId, event }) {
    if (!this.transactionalMailer) {
      return;
    }

    try {
      const ledger = await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId) || {};
      if (event.type === 'customer.subscription.deleted') {
        const alreadySent = typeof this.transactionalMailer.hasSentClaim === 'function'
          ? await this.transactionalMailer.hasSentClaim({
            subscriptionId,
            template: 'cancelled'
          })
          : false;
        if (alreadySent) {
          return;
        }
        await this.transactionalMailer.notifyCancelled({
          ledger,
          subscriptionId,
          referenceId: 'deleted',
          endsAt: subscription.current_period_end || ledger.currentPeriodEnd
        });
        return;
      }

      if (event.type !== 'customer.subscription.updated') {
        return;
      }

      const previous = event.data && event.data.previous_attributes;
      const eventId = String(event.id || '').trim();
      if (this.attributeChanged(previous, 'pause_collection') && eventId) {
        const wasPaused = Boolean(previous.pause_collection);
        const isPaused = Boolean(subscription.pause_collection);
        if (!wasPaused && isPaused) {
          const resumesAt = subscription.pause_collection && subscription.pause_collection.resumes_at;
          await this.transactionalMailer.notifyPaused({
            ledger,
            subscriptionId,
            referenceId: `paused:${eventId}`,
            resumeAt: resumesAt || null
          });
        } else if (wasPaused && !isPaused) {
          await this.transactionalMailer.notifyResumed({
            ledger,
            subscriptionId,
            referenceId: `resumed:${eventId}`
          });
        }
      }

      if (this.attributeChanged(previous, 'cancel_at_period_end')) {
        const wasCancelling = Boolean(previous.cancel_at_period_end);
        const isCancelling = Boolean(subscription.cancel_at_period_end);
        if (!wasCancelling && isCancelling) {
          const periodEnd = subscription.current_period_end || ledger.currentPeriodEnd || '';
          await this.transactionalMailer.notifyCancelled({
            ledger,
            subscriptionId,
            referenceId: `cancel_scheduled:${periodEnd}`,
            endsAt: periodEnd
          });
        }
      }
    } catch (error) {
      this.logger.error({
        template: event && event.type,
        subscriptionId,
        code: error && error.code
      }, 'Transactional email failed.');
    }
  }
}

module.exports = {
  WEBHOOK_EVENT_TIMEOUT_MS,
  WEBHOOK_RETRY_BATCH,
  WEBHOOK_MAX_ATTEMPTS,
  StripeWebhookService
};
