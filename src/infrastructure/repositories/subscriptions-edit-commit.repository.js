const { HttpError } = require('../../core/http-error');
const { buildPetsSnapshot } = require('../../core/stripe-subscription-map');
const { buildCurrentHash } = require('../../core/subscription-edit-hash');
const {
  shippingCostFrom,
  extractStripeItemRefs,
  diffSubscriptionItems,
  mapProrationFromInvoice,
  resolveProposedPlan
} = require('../../core/subscription-edit-plan');

class SubscriptionsEditCommitRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeBilling = options.stripeBilling || null;
    this.planPreviewRepository = options.planPreviewRepository || null;
    this.resolveSubscriptionItems = options.resolveSubscriptionItems || null;
  }

  async commit(userId, subscriptionId, payload = {}, ledgerRow = null) {
    if (!this.ledgerRepository || !this.stripeBilling) {
      throw new HttpError(503, 'Subscription edit commit dependencies are not available.');
    }

    const row = ledgerRow || await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }

    const subscription = await this.stripeBilling.retrieveSubscription(subscriptionId);
    const currentItems = extractStripeItemRefs(subscription);
    if (currentItems.length === 0) {
      throw new HttpError(422, 'Subscription has no Stripe items.', { code: 'invalid_plan' });
    }

    const currentHash = buildCurrentHash({
      items: currentItems.map((item) => ({ price: item.price, quantity: item.quantity })),
      termMonths: row.subscriptionTermMonths,
      address: row.address || {},
      shipping: row.shipping || {}
    });
    if (currentHash !== payload.expected_current_hash) {
      throw new HttpError(409, 'Subscription state changed. Preview again.', {
        code: 'subscription_state_changed'
      });
    }

    const proposed = await resolveProposedPlan(this.planPreviewRepository, this.resolveSubscriptionItems, {
      userId,
      payload
    });
    const itemUpdates = diffSubscriptionItems(currentItems, proposed.items);
    const currentTerm = Number(row.subscriptionTermMonths || 1);
    const proposedTerm = Number(payload.subscription_term_months || currentTerm);
    const termChange = currentTerm !== proposedTerm;

    let proration = { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: proposed.currency };
    try {
      const previewInvoice = await this.stripeBilling.previewProration({
        subscriptionId,
        items: itemUpdates
      });
      proration = mapProrationFromInvoice(previewInvoice, proposed.currency);
    } catch (_error) {
      proration = { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: proposed.currency };
    }

    if (proration.direction === 'charge') {
      const paymentMethodId = String(payload.payment_method_id || subscription.default_payment_method || '').trim();
      const pmId = paymentMethodId.startsWith('pm_')
        ? paymentMethodId
        : (subscription.default_payment_method && subscription.default_payment_method.id
          ? String(subscription.default_payment_method.id)
          : '');
      if (!pmId.startsWith('pm_')) {
        throw new HttpError(422, 'A payment method is required to charge the proration.', {
          code: 'invalid_payment_method'
        });
      }
    }

    const shipping = payload.shipping || row.shipping || {};
    const shippingCost = shippingCostFrom(shipping);
    const metadata = {
      ...(subscription.metadata || {}),
      wp_user_id: String(userId),
      user_id: String(userId),
      source: 'eden_bowls_node',
      subscription_term_months: String(proposedTerm)
    };
    if (shippingCost > 0) {
      metadata.shipping_amount_minor = String(Math.round(shippingCost * 100));
      metadata.shipping_currency = String(proposed.currency || 'usd').toLowerCase();
      if (this.stripeBilling.shippingProductId) {
        metadata.shipping_product_id = String(this.stripeBilling.shippingProductId);
      }
    }

    const updated = await this.stripeBilling.updateSubscriptionItems({
      subscriptionId,
      items: itemUpdates,
      metadata,
      prorationBehavior: proration.direction === 'charge' ? 'always_invoice' : 'create_prorations'
    });

    const invoice = updated.latest_invoice && typeof updated.latest_invoice === 'object'
      ? updated.latest_invoice
      : {};
    const paymentIntent = invoice.payment_intent && typeof invoice.payment_intent === 'object'
      ? invoice.payment_intent
      : {};
    const paymentIntentStatus = String(paymentIntent.status || '');
    const paymentState = this.stripeBilling.resolvePaymentState({
      paymentMethodId: payload.payment_method_id || (updated.default_payment_method && updated.default_payment_method.id),
      paymentIntentStatus: paymentIntentStatus || (proration.direction === 'charge' ? 'requires_confirmation' : 'succeeded')
    });
    const needsConfirmation = Boolean(paymentIntent.client_secret)
      && ['requires_action', 'requires_confirmation'].includes(paymentIntentStatus);
    const editPaymentPending = proration.direction === 'charge' && (needsConfirmation || paymentState === 'requires_confirmation');

    const nextPlanSelection = {
      ...proposed.planSelection,
      subscription_term_months: proposedTerm
    };
    const nextPets = buildPetsSnapshot(nextPlanSelection);

    if (editPaymentPending) {
      await this.ledgerRepository.upsert({
        userId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: row.stripeCustomerId,
        status: row.status,
        editPaymentPending: true,
        editPending: {
          plan_selection: nextPlanSelection,
          term_months: proposedTerm,
          shipping,
          invoice_id: invoice.id || null,
          payment_intent_id: paymentIntent.id || null
        }
      });
    } else {
      await this.ledgerRepository.upsert({
        userId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: row.stripeCustomerId,
        status: row.status,
        planSelection: nextPlanSelection,
        petsSnapshot: nextPets,
        shipping,
        address: payload.address || row.address,
        subscriptionTermMonths: proposedTerm,
        editPaymentPending: false,
        editPending: null
      });
    }

    return {
      subscription_id: subscriptionId,
      pending_webhook_confirmation: true,
      term_change: termChange,
      proration,
      payment_state: editPaymentPending ? 'requires_confirmation' : (proration.direction === 'charge' ? paymentState : 'paid'),
      stripe_invoice_id: invoice.id || undefined,
      stripe_payment_intent_id: paymentIntent.id || undefined,
      stripe_client_secret: editPaymentPending ? (paymentIntent.client_secret || null) : null,
      stripe_payment_intent_status: paymentIntentStatus || undefined,
      edit_payment_pending: editPaymentPending
    };
  }
}

module.exports = {
  SubscriptionsEditCommitRepository
};
