const { HttpError } = require('../core/http-error');
const {
  extractSubscriptionIdFromInvoice,
  extractSubscriptionPeriod,
  mapStripeStatus,
  extractCardFromPaymentMethod
} = require('../core/stripe-subscription-map');

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
    this.stripeBilling = options.stripeBilling || null;
    this.webhookSecret = options.webhookSecret || '';
    this.eventsRepository = options.eventsRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.customerStore = options.customerStore || null;
    this.shippingProductId = options.shippingProductId || '';
    this.logger = options.logger || { error() {}, warn() {}, info() {} };
  }

  async handle({ rawBody, signature }) {
    if (!this.webhookSecret) {
      throw new HttpError(503, 'STRIPE_WEBHOOK_SECRET is not configured.', {
        code: 'stripe_webhook_secret_missing'
      });
    }

    if (!this.stripeBilling) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', {
        code: 'stripe_secret_missing'
      });
    }

    if (!this.eventsRepository || !this.ledgerRepository) {
      throw new HttpError(503, 'Stripe webhook persistence is not available.');
    }

    const event = this.stripeBilling.constructEvent(rawBody, signature, this.webhookSecret);
    const inserted = await this.eventsRepository.insertIfNew({
      eventId: event.id,
      type: event.type,
      payloadSummary: this.summarize(event)
    });

    if (!inserted.inserted) {
      return { received: true };
    }

    if (!HANDLED_TYPES.has(event.type)) {
      return { received: true };
    }

    try {
      await this.dispatch(event);
    } catch (error) {
      this.logger.error({ err: error, eventId: event.id, type: event.type }, 'Stripe webhook processing failed after persist.');
    }

    return { received: true };
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

  async dispatch(event) {
    const object = event.data && event.data.object ? event.data.object : {};
    if (event.type === 'invoice.paid') {
      await this.handleInvoicePaid(object);
      return;
    }
    if (event.type === 'invoice.created') {
      await this.handleInvoiceCreated(object);
      return;
    }
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.processing') {
      await this.handlePaymentIntentUpdate(object);
      return;
    }
    if (event.type === 'payment_intent.payment_failed' || event.type === 'invoice.payment_failed') {
      await this.handlePaymentFailed(object, event.type);
      return;
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await this.handleSubscriptionChanged(object);
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

  async retrieveSubscriptionSafe(subscriptionId) {
    if (!subscriptionId || !this.stripeBilling.retrieveSubscription) {
      return null;
    }
    try {
      return await this.stripeBilling.retrieveSubscription(subscriptionId);
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

  async handleInvoicePaid(invoice) {
    const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
    const subscription = await this.retrieveSubscriptionSafe(subscriptionId);
    const metadata = (subscription && subscription.metadata) || invoice.subscription_details && invoice.subscription_details.metadata || {};
    const context = await this.resolveUserContext({
      subscriptionId,
      customerId: invoice.customer,
      metadataUserId: metadata.wp_user_id || metadata.user_id
    });

    if (!context.userId || !subscriptionId) {
      this.logger.warn({ invoiceId: invoice.id, subscriptionId }, 'invoice.paid skipped: user not resolved.');
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
      status: 'active',
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
  }

  async handleInvoiceCreated(invoice) {
    if (String(invoice.status || '') !== 'draft') {
      return;
    }
    if (String(invoice.billing_reason || '') !== 'subscription_cycle') {
      return;
    }

    const subscriptionId = extractSubscriptionIdFromInvoice(invoice);
    const subscription = await this.retrieveSubscriptionSafe(subscriptionId);
    const metadata = (subscription && subscription.metadata) || {};
    let amountMinor = Number(metadata.shipping_amount_minor || 0);
    let currency = metadata.shipping_currency || invoice.currency || 'usd';
    let productId = metadata.shipping_product_id || this.shippingProductId;

    if (!amountMinor && subscriptionId) {
      const ledger = await this.ledgerRepository.findByStripeSubscriptionId(subscriptionId);
      const shipping = ledger && ledger.shipping ? ledger.shipping : {};
      const cost = Number(shipping.cost || shipping.total || 0);
      if (cost > 0) {
        amountMinor = Math.round(cost * 100);
      }
    }

    if (amountMinor <= 0 || !productId || !String(productId).startsWith('prod_')) {
      return;
    }

    await this.stripeBilling.addShippingInvoiceItem({
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

  async handlePaymentFailed(object, type) {
    const paymentIntentId = type === 'invoice.payment_failed'
      ? String(object.payment_intent && object.payment_intent.id ? object.payment_intent.id : object.payment_intent || '')
      : String(object.id || '');
    const subscriptionId = extractSubscriptionIdFromInvoice(object)
      || String(object.subscription || '');

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
    if (ledger && ['active', 'trialing'].includes(ledger.status)) {
      return;
    }

    await this.ledgerRepository.updateCheckoutReference(userId, {
      payment_state: 'failed',
      stripe_payment_intent_id: paymentIntentId.startsWith('pi_') ? paymentIntentId : undefined,
      stripe_payment_intent_status: String(object.status || 'canceled')
    });
  }

  async handleSubscriptionChanged(subscription) {
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
      status: mapStripeStatus(subscription),
      stripePriceId: item && item.price && item.price.id ? item.price.id : undefined,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      paymentMethodLast4: card.last4 || undefined,
      paymentMethodBrand: card.brand || undefined
    });
  }
}

module.exports = {
  StripeWebhookService
};
