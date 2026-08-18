function createStripeSdk(secretKey, options = {}) {
  if (!secretKey) {
    return null;
  }

  let Stripe;
  try {
    Stripe = require('stripe');
  } catch (_error) {
    return null;
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
    this.client = options.client || createStripeSdk(options.secretKey, options);
    this.automaticTaxEnabled = Boolean(options.automaticTaxEnabled);
    this.shippingProductId = options.shippingProductId || '';
  }

  ensureClient() {
    const { HttpError } = require('../../core/http-error');
    if (!this.client) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
    }
    return this.client;
  }

  stripeMessage(error, fallback) {
    return String(error && error.message ? error.message : fallback);
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

  async ensureCustomer({ email, name, userId, existingCustomerId, address }) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    let customerId = String(existingCustomerId || '').trim();

    if (!customerId.startsWith('cus_')) {
      try {
        const listed = email
          ? await stripe.customers.list({ email, limit: 1 })
          : { data: [] };
        const existing = listed && Array.isArray(listed.data) ? listed.data[0] : null;
        if (existing && existing.id) {
          customerId = existing.id;
        } else {
          const created = await stripe.customers.create({
            email: email || undefined,
            name: name || undefined,
            metadata: { wp_user_id: String(userId || '') }
          });
          customerId = created.id;
        }
      } catch (error) {
        throw new HttpError(502, this.stripeMessage(error, 'Unable to create/retrieve Stripe customer.'), {
          code: 'stripe_customer_failed'
        });
      }
    }

    return customerId;
  }

  async attachPaymentMethod(customerId, paymentMethodId) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const pmId = String(paymentMethodId || '').trim();
    if (!pmId) {
      return null;
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

  resolvePaymentState({ paymentMethodId, paymentIntentStatus }) {
    const status = String(paymentIntentStatus || '');
    if (['succeeded', 'processing', 'requires_capture'].includes(status)) {
      return 'paid';
    }
    if (['requires_action', 'requires_confirmation'].includes(status)) {
      return 'requires_confirmation';
    }
    if (status === 'canceled') {
      return 'failed';
    }
    if (!paymentMethodId || status === 'requires_payment_method') {
      return 'pending_payment_method';
    }
    return 'pending_sync';
  }

  async createOnboardingSubscription(input = {}) {
    const { HttpError } = require('../../core/http-error');
    const stripe = this.ensureClient();
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length === 0) {
      throw new HttpError(422, 'Onboarding checkout is incomplete.', {
        code: 'session_incomplete',
        missing: ['plan_selection']
      });
    }

    const customerId = await this.ensureCustomer(input);
    const paymentMethodId = await this.attachPaymentMethod(customerId, input.paymentMethodId);
    const address = input.address || {};
    const shipping = input.shipping || {};
    const country = String(address.country || '').toUpperCase();
    const customerUpdate = {
      invoice_settings: paymentMethodId ? { default_payment_method: paymentMethodId } : undefined
    };

    if (address.country && address.zipcode) {
      const stripeAddress = {
        country,
        postal_code: String(address.zipcode || address.postal_code || ''),
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

    const metadata = {
      wp_user_id: String(input.userId || ''),
      user_id: String(input.userId || ''),
      source: 'eden_bowls_node'
    };
    if (input.subscriptionTermMonths) {
      metadata.subscription_term_months = String(input.subscriptionTermMonths);
    }

    const subscriptionParams = {
      customer: customerId,
      items: items.map((item) => ({
        price: item.price,
        quantity: Math.max(1, Number(item.quantity) || 1)
      })),
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent', 'latest_invoice.discounts', 'discounts', 'items.data.price'],
      metadata
    };

    if (paymentMethodId) {
      subscriptionParams.default_payment_method = paymentMethodId;
    }

    if (country === 'US' && this.automaticTaxEnabled) {
      subscriptionParams.automatic_tax = { enabled: true };
    }

    if (input.promotionCodeId) {
      subscriptionParams.discounts = [{ promotion_code: input.promotionCodeId }];
    }

    const shippingCost = Number(shipping.cost || shipping.total || 0);
    if (shippingCost > 0) {
      try {
        const productId = await this.ensureShippingProduct();
        const currency = String(input.currency || 'usd').toLowerCase();
        const amountMinor = Math.round(shippingCost * 100);
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
        throw new HttpError(502, this.stripeMessage(error, 'Unable to add shipping to Stripe invoice.'), {
          code: 'stripe_subscription_failed'
        });
      }
    }

    let subscription;
    try {
      subscription = await stripe.subscriptions.create(subscriptionParams);
    } catch (error) {
      throw new HttpError(502, this.stripeMessage(error, 'Unable to create Stripe subscription.'), {
        code: 'stripe_subscription_failed'
      });
    }

    const invoice = subscription.latest_invoice && typeof subscription.latest_invoice === 'object'
      ? subscription.latest_invoice
      : {};
    const paymentIntent = invoice.payment_intent && typeof invoice.payment_intent === 'object'
      ? invoice.payment_intent
      : {};
    const clientSecret = paymentIntent.client_secret || '';
    const paymentIntentStatus = String(paymentIntent.status || '');
    const paymentState = this.resolvePaymentState({
      paymentMethodId,
      paymentIntentStatus
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
        order_id: Date.now(),
        order_key: `sub_${subscription.id || 'pending'}`,
        status: String(subscription.status || 'incomplete'),
        total,
        subtotal,
        product_tax: tax,
        shipping_total: shippingTotal,
        shipping_tax: 0,
        shipping_total_with_tax: shippingTotal,
        currency: String(invoice.currency || input.currency || 'usd').toUpperCase(),
        payment_url: undefined,
        subscription_ids: [],
        flexible_subscription_id: 0,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customerId,
        stripe_client_secret: clientSecret || undefined,
        stripe_payment_intent_id: paymentIntent.id || undefined,
        stripe_payment_intent_status: paymentIntentStatus || undefined,
        payment_state: paymentState,
        has_payment_method: Boolean(paymentMethodId),
        reused: false
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
        expand: options.expand || ['items.data.price', 'default_payment_method', 'latest_invoice.payment_intent']
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
      expand: ['latest_invoice.payment_intent', 'items.data.price', 'default_payment_method']
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
  createStripeSdk
};
