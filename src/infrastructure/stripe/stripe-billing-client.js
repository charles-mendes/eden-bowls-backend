function isSeedStripePriceId(priceId) {
  return String(priceId || '').startsWith('price_seed_');
}

function seedLookupKey(priceId) {
  return `eden_${String(priceId || '').replace(/^price_/, '')}`;
}

function toMinorUnit(amount) {
  return Math.round(Number(amount) * 100);
}

function paymentIntentIdFromClientSecret(clientSecret) {
  const secret = String(clientSecret || '');
  if (!secret.startsWith('pi_')) {
    return '';
  }
  const index = secret.indexOf('_secret');
  return index > 0 ? secret.slice(0, index) : '';
}

function firstPaymentIntentFromInvoicePayments(invoice = {}) {
  const entries = invoice.payments && Array.isArray(invoice.payments.data)
    ? invoice.payments.data
    : [];

  for (const entry of entries) {
    const payment = entry && entry.payment ? entry.payment : entry;
    const nested = payment && payment.payment_intent;
    if (nested && typeof nested === 'object') {
      return nested;
    }
    if (typeof nested === 'string' && nested.startsWith('pi_')) {
      return { id: nested };
    }
  }

  return {};
}

function stripeErrorInfo(error) {
  const raw = error && error.raw && typeof error.raw === 'object' ? error.raw : {};
  return {
    stripe_code: String((error && error.code) || raw.code || '') || null,
    stripe_type: String((error && (error.type || error.rawType)) || raw.type || '') || null,
    stripe_param: String((error && error.param) || raw.param || '') || null
  };
}

function couponIdFromPromotion(promo = {}) {
  const nested = promo.promotion && promo.promotion.coupon;
  if (nested && typeof nested === 'object' && nested.id) {
    return String(nested.id);
  }
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim();
  }
  if (promo.coupon && typeof promo.coupon === 'object' && promo.coupon.id) {
    return String(promo.coupon.id);
  }
  if (typeof promo.coupon === 'string' && promo.coupon.trim()) {
    return promo.coupon.trim();
  }
  return '';
}

function extractInvoicePayment(invoice = {}) {
  const confirmation = invoice.confirmation_secret && typeof invoice.confirmation_secret === 'object'
    ? invoice.confirmation_secret
    : {};
  const paymentIntent = invoice.payment_intent && typeof invoice.payment_intent === 'object'
    ? invoice.payment_intent
    : firstPaymentIntentFromInvoicePayments(invoice);
  const clientSecret = String(confirmation.client_secret || paymentIntent.client_secret || '');
  const paymentIntentId = String(
    paymentIntent.id || paymentIntentIdFromClientSecret(clientSecret) || ''
  );

  return {
    clientSecret,
    paymentIntentId,
    paymentIntentStatus: String(paymentIntent.status || '')
  };
}

function createStripeSdk(secretKey, options = {}) {
  if (!secretKey) {
    return null;
  }

  let Stripe;
  try {
    Stripe = require('stripe');
  } catch (error) {
    const sdkError = new Error('Stripe SDK is not available in this environment.');
    sdkError.code = 'stripe_sdk_missing';
    sdkError.cause = error;
    throw sdkError;
  }

  const clientOptions = {};
  if (options.apiVersion) {
    clientOptions.apiVersion = options.apiVersion;
  }
  if (Number.isFinite(Number(options.maxNetworkRetries))) {
    clientOptions.maxNetworkRetries = Number(options.maxNetworkRetries);
  }

  return new Stripe(secretKey, clientOptions);
}

class StripeBillingClient {
  constructor(options = {}) {
    this.automaticTaxEnabled = Boolean(options.automaticTaxEnabled);
    this.shippingProductId = options.shippingProductId || '';
    this.missingReason = null;

    if (options.client) {
      this.client = options.client;
      return;
    }

    try {
      this.client = createStripeSdk(options.secretKey, options);
      this.missingReason = this.client ? null : 'secret';
    } catch (error) {
      if (error && error.code === 'stripe_sdk_missing') {
        this.client = null;
        this.missingReason = 'sdk';
        return;
      }
      throw error;
    }
  }

  ensureClient() {
    const { HttpError } = require('../../core/http-error');
    if (this.client) {
      return this.client;
    }
    if (this.missingReason === 'sdk') {
      throw new HttpError(503, 'Stripe SDK is not available in this environment.', {
        code: 'stripe_sdk_missing'
      });
    }
    throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
  }

  async ensureRecurringPrice({ lookupKey, currency, unitAmount, nickname }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const key = String(lookupKey || '').trim();
    const currencyCode = String(currency || '').trim().toLowerCase();
    const amount = Number(unitAmount);

    if (!key || !currencyCode || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpError(422, 'A catalog variant is not mapped to a Stripe price.', {
        code: 'unmapped_variant'
      });
    }

    try {
      const listed = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
      const existing = listed && Array.isArray(listed.data) ? listed.data[0] : null;
      if (existing && existing.id) {
        return existing.id;
      }

      const product = await stripe.products.create({
        name: nickname || key,
        metadata: { source: 'eden_bowls_seed', lookup_key: key }
      });
      const price = await stripe.prices.create({
        currency: currencyCode,
        unit_amount: amount,
        recurring: { interval: 'month' },
        product: product.id,
        lookup_key: key,
        nickname: nickname || key,
        tax_behavior: 'exclusive'
      });
      if (!price || !String(price.id || '').startsWith('price_')) {
        throw new HttpError(502, 'Unable to create Stripe price.', {
          code: 'stripe_price_ensure_failed'
        });
      }
      return price.id;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      try {
        const listed = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
        const existing = listed && Array.isArray(listed.data) ? listed.data[0] : null;
        if (existing && existing.id) {
          return existing.id;
        }
      } catch (_retryError) {
        // Fall through to the original Stripe error.
      }
      throw new HttpError(502, this.stripeMessage(error, 'Unable to create Stripe price.'), {
        code: 'stripe_price_ensure_failed'
      });
    }
  }

  async materializeSeedPrices(items = [], input = {}) {
    const fallbackCurrency = String(input.currency || 'usd').toLowerCase();
    const resolved = [];

    for (const item of Array.isArray(items) ? items : []) {
      const price = String(item && item.price || '').trim();
      if (!isSeedStripePriceId(price)) {
        resolved.push({ ...item, price });
        continue;
      }

      const livePriceId = await this.ensureRecurringPrice({
        lookupKey: seedLookupKey(price),
        currency: String(item.currency || fallbackCurrency).toLowerCase(),
        unitAmount: toMinorUnit(item.unit_price),
        nickname: price
      });
      resolved.push({ ...item, price: livePriceId });
    }

    return resolved;
  }

  stripeMessage(error, fallback) {
    const type = String(error && error.type ? error.type : '');
    const code = String(error && error.code ? error.code : '');
    if (code === 'resource_missing') {
      return 'The requested Stripe resource was not found.';
    }
    if (type === 'StripeCardError' || type === 'card_error' || code === 'card_declined') {
      return 'The card could not be charged.';
    }
    if (type === 'StripeIdempotencyError' || code === 'idempotency_error' || code === 'idempotency_key_in_use') {
      return 'A conflicting checkout request is already in progress.';
    }
    return String(fallback || 'Stripe request failed.');
  }

  async listCardPaymentMethods(customerId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const id = String(customerId || '').trim();
    if (!id.startsWith('cus_')) {
      return [];
    }

    let customer;
    try {
      customer = await stripe.customers.retrieve(id);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to retrieve Stripe customer.'), {
        code: 'stripe_customer_retrieve_failed'
      });
    }

    if (!customer || customer.deleted) {
      return [];
    }

    let listed;
    try {
      listed = await stripe.paymentMethods.list({ customer: id, type: 'card' });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to list payment methods.'), {
        code: 'stripe_payment_methods_list_failed'
      });
    }

    const defaultPm = String(
      customer.invoice_settings && customer.invoice_settings.default_payment_method || ''
    );

    return (listed && Array.isArray(listed.data) ? listed.data : []).map((method) => {
      const card = method.card || {};
      return {
        id: String(method.id || ''),
        brand: String(card.brand || ''),
        last4: String(card.last4 || ''),
        exp_month: Number(card.exp_month || 0),
        exp_year: Number(card.exp_year || 0),
        is_default: String(method.id || '') === defaultPm || String(defaultPm) === String(method.id || '')
      };
    });
  }

  async previewSubscriptionInvoice({ address = {}, items = [] }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const customerAddress = {
      country: 'US',
      state: String(address.state || '').trim(),
      postal_code: String(address.postal_code || address.postalCode || '').trim()
    };
    if (address.line1) {
      customerAddress.line1 = String(address.line1).trim();
    }
    if (address.city) {
      customerAddress.city = String(address.city).trim();
    }

    try {
      const invoice = await stripe.invoices.createPreview({
        automatic_tax: { enabled: true },
        customer_details: { address: customerAddress },
        subscription_details: {
          items: items.map((item) => ({
            price: item.price,
            quantity: Math.max(1, Number(item.quantity) || 1)
          }))
        }
      });

      const subtotalMinor = Number(invoice.subtotal || 0);
      const totalMinor = Number(invoice.total || 0);
      const taxMinor = invoice.tax == null ? Math.max(0, totalMinor - subtotalMinor) : Number(invoice.tax || 0);

      return {
        subtotal: Number((subtotalMinor / 100).toFixed(2)),
        tax: Number((taxMinor / 100).toFixed(2)),
        total: Number((totalMinor / 100).toFixed(2)),
        currency: String(invoice.currency || 'usd').toLowerCase()
      };
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to preview Stripe invoice.'), {
        code: 'stripe_preview_failed'
      });
    }
  }

  async ensureCustomer({ email, name, userId, existingCustomerId }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    let customerId = String(existingCustomerId || '').trim();

    if (customerId.startsWith('cus_')) {
      try {
        const existing = await stripe.customers.retrieve(customerId);
        if (existing && existing.id && !existing.deleted) {
          return existing.id;
        }
      } catch (error) {
        if (String(error && error.code) !== 'resource_missing') {
          throw new HttpError(502, this.stripeMessage(error, 'Unable to retrieve Stripe customer.'), {
            code: 'stripe_customer_failed'
          });
        }
      }
      customerId = '';
    }

    try {
      const listed = email
        ? await stripe.customers.list({ email, limit: 1 })
        : { data: [] };
      const existing = listed && Array.isArray(listed.data) ? listed.data[0] : null;
      if (existing && existing.id) {
        return existing.id;
      }

      const created = await stripe.customers.create({
        email: email || undefined,
        name: name || undefined,
        metadata: {
          wp_user_id: String(userId || ''),
          user_id: String(userId || '')
        }
      });
      if (!created || !String(created.id || '').startsWith('cus_')) {
        throw new HttpError(502, 'Unable to create/retrieve Stripe customer.', {
          code: 'stripe_customer_failed'
        });
      }
      return created.id;
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(502, this.stripeMessage(error, 'Unable to create/retrieve Stripe customer.'), {
        code: 'stripe_customer_failed'
      });
    }
  }

  async attachPaymentMethod(customerId, paymentMethodId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const pmId = String(paymentMethodId || '').trim();
    if (!pmId.startsWith('pm_')) {
      throw new HttpError(422, 'A valid payment method is required.', {
        code: 'invalid_payment_method'
      });
    }

    let paymentMethod;
    try {
      paymentMethod = await stripe.paymentMethods.retrieve(pmId);
    } catch (error) {
      throw new HttpError(422, this.stripeMessage(error, 'Invalid payment method.'), {
        code: 'invalid_payment_method'
      });
    }

    const attachedCustomer = paymentMethod && paymentMethod.customer ? String(paymentMethod.customer) : '';
    if (attachedCustomer && attachedCustomer !== customerId) {
      throw new HttpError(409, 'This payment method is attached to a different Stripe customer.', {
        code: 'payment_method_attached_to_other_customer'
      });
    }

    if (!attachedCustomer) {
      try {
        await stripe.paymentMethods.attach(pmId, { customer: customerId });
      } catch (error) {
        throw new HttpError(502, this.stripeMessage(error, 'Unable to attach payment method.'), {
          code: 'stripe_payment_method_attach_failed'
        });
      }
    }

    return pmId;
  }

  async resolveCheckoutCoupon(promotionCodeId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const promoId = String(promotionCodeId || '').trim();
    if (!promoId) {
      return '';
    }

    if (!stripe.promotionCodes || !stripe.promotionCodes.retrieve) {
      return '';
    }

    let promo;
    try {
      promo = await stripe.promotionCodes.retrieve(promoId);
    } catch (error) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id',
        ...stripeErrorInfo(error)
      });
    }

    if (!promo || promo.active === false) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id'
      });
    }

    const couponId = couponIdFromPromotion(promo);
    if (!couponId) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id'
      });
    }

    return couponId;
  }

  async findReusableIncompleteSubscription({ customerId, fingerprint, userId }) {
    const stripe = this.ensureClient();
    if (!stripe.subscriptions || !stripe.subscriptions.list) {
      return null;
    }

    let listed;
    try {
      listed = await stripe.subscriptions.list({
        customer: customerId,
        status: 'incomplete',
        limit: 20
      });
    } catch (_error) {
      return null;
    }

    const rows = listed && Array.isArray(listed.data) ? listed.data : [];
    const fingerprintValue = String(fingerprint || '');
    const userValue = String(userId || '');
    if (fingerprintValue) {
      const matched = rows.find((subscription) => (
        String(subscription.metadata && subscription.metadata.checkout_context_fingerprint || '') === fingerprintValue
      ));
      if (matched) {
        return matched;
      }
    }

    const byUser = rows.filter((subscription) => {
      const metadata = subscription.metadata || {};
      return String(metadata.user_id || metadata.wp_user_id || '') === userValue;
    });
    return byUser.length === 1 ? byUser[0] : null;
  }

  async loadInvoicePayment(subscription) {
    const stripe = this.ensureClient();
    const invoiceId = typeof subscription.latest_invoice === 'string'
      ? subscription.latest_invoice
      : (subscription.latest_invoice && subscription.latest_invoice.id);
    let invoice = subscription.latest_invoice && typeof subscription.latest_invoice === 'object'
      ? subscription.latest_invoice
      : {};
    let payment = extractInvoicePayment(invoice);
    if (!payment.clientSecret && invoiceId && stripe.invoices && stripe.invoices.retrieve) {
      invoice = await stripe.invoices.retrieve(invoiceId, {
        expand: ['confirmation_secret']
      });
      payment = extractInvoicePayment(invoice);
    }
    return { invoice, payment };
  }

  async ensureShippingProduct() {
    const stripe = this.ensureClient();
    if (this.shippingProductId && String(this.shippingProductId).startsWith('prod_')) {
      return this.shippingProductId;
    }

    const created = await stripe.products.create({
      name: 'Shipping',
      tax_code: 'txcd_92010001'
    });
    this.shippingProductId = created.id;
    return this.shippingProductId;
  }

  resolvePaymentState({ paymentMethodId, paymentIntentStatus, clientSecret, subscriptionId } = {}) {
    const status = String(paymentIntentStatus || '');
    if (['succeeded', 'processing', 'requires_capture'].includes(status)) {
      return 'paid';
    }
    if (status === 'requires_payment_method' || status === 'canceled') {
      return 'failed';
    }
    if (String(clientSecret || '').trim()) {
      return 'requires_confirmation';
    }
    if (String(subscriptionId || '').startsWith('sub_') && paymentMethodId) {
      return 'requires_confirmation';
    }
    if (paymentMethodId) {
      return 'pending_sync';
    }
    return 'pending_payment_method';
  }

  assertSubscriptionItems(items) {
    const { HttpError } = require('../../core/http-error');
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(422, 'At least one valid Stripe price is required.', {
        code: 'invalid_price_id'
      });
    }

    for (const item of items) {
      const price = String(item && item.price || '').trim();
      const quantity = Number(item && item.quantity);
      if (!price.startsWith('price_') || !Number.isFinite(quantity) || quantity < 1) {
        throw new HttpError(422, 'Subscription items are invalid.', {
          code: 'invalid_subscription_items'
        });
      }
    }
  }

  async assertItemsShareCycle(items) {
    const { HttpError } = require('../../core/http-error');
    if (!Array.isArray(items) || items.length <= 1) {
      return;
    }

    const stripe = this.ensureClient();
    const prices = [];
    for (const item of items) {
      try {
        prices.push(await stripe.prices.retrieve(item.price));
      } catch (error) {
        throw new HttpError(502, this.stripeMessage(error, 'Unable to retrieve Stripe price.'), {
          code: 'stripe_price_retrieve_failed'
        });
      }
    }

    const first = prices[0] || {};
    const currency = String(first.currency || '');
    const interval = String(first.recurring && first.recurring.interval || '');
    const intervalCount = Number(first.recurring && first.recurring.interval_count || 0);
    const mixed = prices.some((price) => (
      String(price.currency || '') !== currency
      || String(price.recurring && price.recurring.interval || '') !== interval
      || Number(price.recurring && price.recurring.interval_count || 0) !== intervalCount
    ));

    if (mixed) {
      throw new HttpError(422, 'Subscription items must share the same currency and billing cycle.', {
        code: 'invalid_subscription_items_mixed_cycle_or_currency'
      });
    }
  }

  async retrievePaymentIntent(paymentIntentId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const id = String(paymentIntentId || '').trim();
    if (!id.startsWith('pi_')) {
      throw new HttpError(422, 'Invalid payment intent id.', { code: 'invalid_payment_intent_id' });
    }

    try {
      return await stripe.paymentIntents.retrieve(id);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to retrieve payment intent.'), {
        code: 'stripe_payment_intent_retrieve_failed'
      });
    }
  }

  async createOnboardingSubscription(input = {}) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const items = await this.materializeSeedPrices(Array.isArray(input.items) ? input.items : [], input);
    this.assertSubscriptionItems(items);

    const paymentMethodIdInput = String(input.paymentMethodId || '').trim();
    if (!paymentMethodIdInput.startsWith('pm_')) {
      throw new HttpError(422, 'A valid payment method is required.', {
        code: 'invalid_payment_method'
      });
    }

    const promotionCodeId = String(input.promotionCodeId || '').trim();
    if (promotionCodeId && !promotionCodeId.startsWith('promo_')) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id'
      });
    }

    const address = input.address || {};
    const shipping = input.shipping || {};
    const country = String(address.country || '').toUpperCase();
    const zipcode = String(address.zipcode || address.postal_code || '').trim();
    if (country === 'US' && this.automaticTaxEnabled && !zipcode) {
      throw new HttpError(422, 'Sales tax quote is unavailable.', {
        code: 'sales_tax_unavailable'
      });
    }

    await this.assertItemsShareCycle(items);

    const customerId = await this.ensureCustomer(input);
    const paymentMethodId = await this.attachPaymentMethod(customerId, paymentMethodIdInput);
    const customerUpdate = {
      invoice_settings: { default_payment_method: paymentMethodId }
    };

    if (country && zipcode) {
      const stripeAddress = {
        country,
        postal_code: zipcode,
        state: String(address.state || ''),
        city: String(address.city || ''),
        line1: String(address.street || address.address_line1 || address.line1 || '')
      };
      customerUpdate.address = stripeAddress;
      customerUpdate.shipping = {
        name: input.name || 'Customer',
        address: stripeAddress
      };
    }

    try {
      await stripe.customers.update(customerId, customerUpdate);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to update Stripe customer.'), {
        code: 'stripe_customer_failed'
      });
    }

    const couponId = await this.resolveCheckoutCoupon(promotionCodeId);
    const reusable = await this.findReusableIncompleteSubscription({
      customerId,
      fingerprint: input.checkoutContextFingerprint,
      userId: input.userId
    });
    if (reusable && reusable.id) {
      if (stripe.subscriptions.update) {
        try {
          await stripe.subscriptions.update(reusable.id, {
            default_payment_method: paymentMethodId
          });
        } catch (_error) {
          // Keep the existing incomplete subscription even if the PM update fails.
        }
      }
      return this.buildOnboardingCheckoutResult({
        customerId,
        subscription: reusable,
        paymentMethodId,
        shippingCost: Number(shipping.cost || shipping.total || 0),
        currency: input.currency,
        reused: true
      });
    }

    const metadata = {
      wp_user_id: String(input.userId || ''),
      user_id: String(input.userId || ''),
      source: 'eden_bowls_node'
    };
    if (input.subscriptionTermMonths) {
      metadata.subscription_term_months = String(input.subscriptionTermMonths);
    }
    if (input.attemptId) {
      metadata.attempt_id = String(input.attemptId);
    }
    if (input.checkoutContextFingerprint) {
      metadata.checkout_context_fingerprint = String(input.checkoutContextFingerprint);
    }
    if (promotionCodeId) {
      metadata.hsr_promotion_code_id = promotionCodeId;
    }
    if (couponId) {
      metadata.hsr_coupon_id = couponId;
    }

    const subscriptionParams = {
      customer: customerId,
      items: items.map((item) => ({
        price: item.price,
        quantity: Math.max(1, Number(item.quantity) || 1)
      })),
      default_payment_method: paymentMethodId,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      billing_mode: { type: 'flexible' },
      metadata
    };

    if (country === 'US' && this.automaticTaxEnabled) {
      subscriptionParams.automatic_tax = { enabled: true };
    }

    if (couponId) {
      subscriptionParams.discounts = [{ coupon: couponId }];
    }

    const shippingCost = Number(shipping.cost || shipping.total || 0);
    if (shippingCost > 0) {
      const currency = String(input.currency || '').trim().toLowerCase();
      if (!currency) {
        throw new HttpError(422, 'Shipping currency is required.', {
          code: 'shipping_currency_missing'
        });
      }
      const amountMinor = Math.round(shippingCost * 100);
      if (amountMinor <= 0) {
        throw new HttpError(422, 'Shipping amount is invalid.', {
          code: 'shipping_amount_invalid'
        });
      }

      try {
        const productId = await this.ensureShippingProduct();
        subscriptionParams.metadata.shipping_amount_minor = String(amountMinor);
        subscriptionParams.metadata.shipping_currency = currency;
        subscriptionParams.metadata.shipping_product_id = String(productId);
        subscriptionParams.add_invoice_items = [{
          price_data: {
            currency,
            product: productId,
            unit_amount: amountMinor,
            tax_behavior: 'exclusive'
          },
          quantity: 1
        }];
      } catch (error) {
        if (error instanceof HttpError) {
          throw error;
        }
        throw new HttpError(502, this.stripeMessage(error, 'Unable to add shipping to Stripe invoice.'), {
          code: 'stripe_subscription_failed'
        });
      }
    }

    const createOptions = {};
    if (input.idempotencyKey) {
      createOptions.idempotencyKey = String(input.idempotencyKey);
    }

    let subscription;
    try {
      subscription = await stripe.subscriptions.create(subscriptionParams, createOptions);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to create Stripe subscription.'), {
        code: 'stripe_subscription_failed',
        ...stripeErrorInfo(error)
      });
    }

    return this.buildOnboardingCheckoutResult({
      customerId,
      subscription,
      paymentMethodId,
      shippingCost,
      currency: input.currency,
      reused: false
    });
  }

  async buildOnboardingCheckoutResult({
    customerId,
    subscription,
    paymentMethodId,
    shippingCost,
    currency,
    reused
  }) {
    const { HttpError } = require('../../core/http-error');
    let invoice;
    let payment;
    try {
      ({ invoice, payment } = await this.loadInvoicePayment(subscription));
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to create Stripe subscription.'), {
        code: 'stripe_client_secret_missing',
        ...stripeErrorInfo(error)
      });
    }

    const clientSecret = payment.clientSecret;
    if (!subscription.id || !clientSecret) {
      throw new HttpError(502, 'Unable to create Stripe subscription.', {
        code: 'stripe_client_secret_missing'
      });
    }

    const paymentIntentStatus = payment.paymentIntentStatus;
    const paymentState = this.resolvePaymentState({
      paymentMethodId,
      paymentIntentStatus,
      clientSecret,
      subscriptionId: subscription.id
    });

    const subtotal = Number(((invoice.subtotal || 0) / 100).toFixed(2));
    const total = Number(((invoice.total || invoice.amount_due || 0) / 100).toFixed(2));
    const tax = Number(((invoice.tax == null ? Math.max(0, (invoice.total || 0) - (invoice.subtotal || 0)) : invoice.tax) / 100).toFixed(2));
    const shippingTotal = Number(Number(shippingCost).toFixed(2));

    return {
      customerId,
      shippingProductId: this.shippingProductId || '',
      subscription,
      checkout: {
        order_id: 0,
        order_key: subscription.id ? `sub_${subscription.id}` : '',
        status: String(subscription.status || 'incomplete'),
        total,
        subtotal,
        product_tax: tax,
        shipping_total: shippingTotal,
        shipping_tax: 0,
        shipping_total_with_tax: shippingTotal,
        currency: String(invoice.currency || currency || 'usd').toUpperCase(),
        payment_url: '',
        subscription_ids: [],
        flexible_subscription_id: 0,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customerId,
        stripe_client_secret: clientSecret || undefined,
        stripe_payment_intent_id: payment.paymentIntentId || undefined,
        stripe_payment_intent_status: paymentIntentStatus || undefined,
        stripe_subscription_status: String(subscription.status || 'incomplete'),
        payment_state: paymentState,
        has_payment_method: true,
        reused: Boolean(reused)
      }
    };
  }

  constructEvent(rawBody, signature, secret) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    if (!secret) {
      throw new HttpError(503, 'STRIPE_WEBHOOK_SECRET is not configured.', {
        code: 'stripe_webhook_secret_missing'
      });
    }
    if (!signature) {
      throw new HttpError(400, 'Missing Stripe-Signature header.', {
        code: 'stripe_webhook_signature_invalid'
      });
    }

    try {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      throw new HttpError(400, this.stripeMessage(error, 'Invalid Stripe signature.'), {
        code: 'stripe_webhook_signature_invalid'
      });
    }
  }

  async retrieveSubscription(subscriptionId, options = {}) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const id = String(subscriptionId || '').trim();
    if (!id.startsWith('sub_')) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    try {
      return await stripe.subscriptions.retrieve(id, {
        expand: options.expand || ['items.data.price', 'default_payment_method', 'latest_invoice.confirmation_secret']
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to retrieve Stripe subscription.'), {
        code: 'stripe_subscription_retrieve_failed'
      });
    }
  }

  async listByCustomer(customerId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const id = String(customerId || '').trim();
    if (!id.startsWith('cus_')) {
      return [];
    }

    try {
      const listed = await stripe.subscriptions.list({
        customer: id,
        status: 'all',
        limit: 100
      });
      return listed && Array.isArray(listed.data) ? listed.data : [];
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to list Stripe subscriptions.'), {
        code: 'stripe_subscriptions_list_failed'
      });
    }
  }

  async pauseSubscription(subscriptionId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      return await stripe.subscriptions.update(subscriptionId, {
        pause_collection: { behavior: 'void' }
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to pause Stripe subscription.'), {
        code: 'stripe_subscription_pause_failed'
      });
    }
  }

  async resumeSubscription(subscriptionId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      return await stripe.subscriptions.update(subscriptionId, {
        pause_collection: ''
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to resume Stripe subscription.'), {
        code: 'stripe_subscription_resume_failed'
      });
    }
  }

  async setCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      return await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: Boolean(cancelAtPeriodEnd)
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to update auto-renew on Stripe subscription.'), {
        code: 'stripe_subscription_cancel_at_period_end_failed'
      });
    }
  }

  async cancelSubscription(subscriptionId) {
    return this.setCancelAtPeriodEnd(subscriptionId, true);
  }

  async cancelSubscriptionImmediately(subscriptionId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const id = String(subscriptionId || '').trim();
    if (!id.startsWith('sub_')) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    try {
      if (typeof stripe.subscriptions.cancel === 'function') {
        return await stripe.subscriptions.cancel(id);
      }

      return await stripe.subscriptions.del(id);
    } catch (error) {
      if (String(error && error.code || '') === 'resource_missing') {
        return { id, status: 'canceled' };
      }

      throw new HttpError(502, this.stripeMessage(error, 'Unable to cancel Stripe subscription.'), {
        code: 'stripe_subscription_cancel_failed'
      });
    }
  }

  async updateDefaultPaymentMethod(customerId, paymentMethodId, subscriptionId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const attached = await this.attachPaymentMethod(customerId, paymentMethodId);
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: attached }
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to update default payment method.'), {
        code: 'stripe_payment_method_default_failed'
      });
    }

    if (subscriptionId) {
      try {
        await stripe.subscriptions.update(subscriptionId, {
          default_payment_method: attached
        });
      } catch (error) {
        throw new HttpError(502, this.stripeMessage(error, 'Unable to update subscription payment method.'), {
          code: 'stripe_subscription_payment_method_failed'
        });
      }
    }

    return attached;
  }

  async addShippingInvoiceItem({ invoiceId, customerId, productId, amount, currency }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      return await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoiceId,
        price_data: {
          currency: String(currency || 'usd').toLowerCase(),
          product: productId,
          unit_amount: Math.round(Number(amount) || 0),
          tax_behavior: 'exclusive'
        },
        quantity: 1
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to add shipping invoice item.'), {
        code: 'stripe_shipping_invoice_item_failed'
      });
    }
  }

  async previewProration({ subscriptionId, items, prorationBehavior = 'create_prorations' }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      return await stripe.invoices.createPreview({
        subscription: subscriptionId,
        subscription_details: {
          items,
          proration_behavior: prorationBehavior
        }
      });
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to preview subscription proration.'), {
        code: 'stripe_proration_preview_failed'
      });
    }
  }

  async updateSubscriptionItems({ subscriptionId, items, metadata, prorationBehavior = 'create_prorations' }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const params = {
      items,
      proration_behavior: prorationBehavior,
      expand: ['latest_invoice.confirmation_secret', 'items.data.price', 'default_payment_method']
    };
    if (metadata && typeof metadata === 'object') {
      params.metadata = metadata;
    }

    try {
      return await stripe.subscriptions.update(subscriptionId, params);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to update Stripe subscription.'), {
        code: 'stripe_subscription_update_failed'
      });
    }
  }

  async listInvoicesForSubscription(subscriptionId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    try {
      const listed = await stripe.invoices.list({
        subscription: subscriptionId,
        limit: 12
      });
      return listed && Array.isArray(listed.data) ? listed.data : [];
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to list Stripe invoices.'), {
        code: 'stripe_invoices_list_failed'
      });
    }
  }
}

module.exports = {
  StripeBillingClient,
  createStripeSdk,
  extractInvoicePayment,
  couponIdFromPromotion
};
