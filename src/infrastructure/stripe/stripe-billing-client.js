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

    const subscriptionParams = {
      customer: customerId,
      items: items.map((item) => ({
        price: item.price,
        quantity: Math.max(1, Number(item.quantity) || 1)
      })),
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent', 'latest_invoice.discounts', 'discounts'],
      metadata: {
        wp_user_id: String(input.userId || ''),
        source: 'eden_bowls_node'
      }
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
        subscriptionParams.add_invoice_items = [{
          price_data: {
            currency,
            product: productId,
            unit_amount: Math.round(shippingCost * 100),
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
}

module.exports = {
  StripeBillingClient,
  createStripeSdk
};
