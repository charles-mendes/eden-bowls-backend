const { HttpError } = require('../../core/http-error');
const { buildCurrentHash } = require('../../core/subscription-edit-hash');
const {
  countryFromPayload,
  shippingCostFrom,
  extractStripeItemRefs,
  diffSubscriptionItems,
  mapProrationFromInvoice,
  resolveProposedPlan
} = require('../../core/subscription-edit-plan');
const { roundMoney } = require('../../core/plan-catalog-pricing');

class SubscriptionsEditPreviewRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeBilling = options.stripeBilling || null;
    this.planPreviewRepository = options.planPreviewRepository || null;
    this.resolveSubscriptionItems = options.resolveSubscriptionItems || null;
  }

  async preview(userId, subscriptionId, payload = {}, ledgerRow = null) {
    if (!this.ledgerRepository || !this.stripeBilling) {
      throw new HttpError(503, 'Subscription edit preview dependencies are not available.');
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

    const proposed = await resolveProposedPlan(this.planPreviewRepository, this.resolveSubscriptionItems, {
      userId,
      payload
    });
    const itemUpdates = diffSubscriptionItems(currentItems, proposed.items);
    const hash = buildCurrentHash({
      items: currentItems.map((item) => ({ price: item.price, quantity: item.quantity })),
      termMonths: row.subscriptionTermMonths,
      address: row.address || {},
      shipping: row.shipping || {}
    });

    let prorationInvoice = {};
    try {
      prorationInvoice = await this.stripeBilling.previewProration({
        subscriptionId,
        items: itemUpdates
      });
    } catch (_error) {
      prorationInvoice = {};
    }

    const currency = proposed.currency || 'USD';
    const shippingCost = shippingCostFrom(payload.shipping || row.shipping || {});
    const nextCycle = await this.buildNextCycle({
      payload,
      proposed,
      shippingCost,
      currency
    });

    const currentTerm = Number(row.subscriptionTermMonths || 1);
    const proposedTerm = Number(payload.subscription_term_months || currentTerm);

    return {
      subscription_id: subscriptionId,
      expected_current_hash: hash,
      term_change: currentTerm !== proposedTerm,
      current: {
        subscription_term_months: currentTerm,
        items: currentItems,
        address: row.address || {},
        status: row.status
      },
      proposed: {
        subscription_term_months: proposedTerm,
        items: proposed.items,
        address: payload.address || row.address || {},
        plan_selection: proposed.planSelection
      },
      proration: mapProrationFromInvoice(prorationInvoice, currency),
      next_cycle: nextCycle,
      discount: {
        eligible: false,
        reason: 'edit_no_first_purchase_promo',
        percent: 0
      }
    };
  }

  async buildNextCycle({ payload, proposed, shippingCost, currency }) {
    const country = countryFromPayload(payload);
    if (country === 'US' && this.stripeBilling.previewSubscriptionInvoice) {
      const preview = await this.stripeBilling.previewSubscriptionInvoice({
        address: payload.address || {},
        items: proposed.items
      });
      return {
        subtotal: preview.subtotal,
        tax: preview.tax,
        total: roundMoney(Number(preview.total) + shippingCost),
        currency: String(preview.currency || currency).toUpperCase()
      };
    }

    return {
      subtotal: proposed.catalogSubtotal,
      tax: 0,
      total: roundMoney(proposed.catalogSubtotal + shippingCost),
      currency: String(currency).toUpperCase()
    };
  }
}

module.exports = {
  SubscriptionsEditPreviewRepository
};
