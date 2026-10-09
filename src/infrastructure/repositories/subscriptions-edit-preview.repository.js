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
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');
const { verifiedEditShipping } = require('../../core/shipping-quote-token');
const { resolveMarket } = require('../../core/market');
const { assertPackOnlyChange, buildPackAdjustment, withStoredPets } = require('../../core/pack-adjustment');

const NO_PRORATION = (currency) => ({
  direction: 'none',
  amount_due_now: 0,
  credit_applied: 0,
  currency: String(currency || 'USD').toUpperCase()
});

class SubscriptionsEditPreviewRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.planPreviewRepository = options.planPreviewRepository || null;
    this.resolveSubscriptionItems = options.resolveSubscriptionItems || null;
    this.shippingQuoteSigner = options.shippingQuoteSigner || null;
  }

  async preview(userId, subscriptionId, requestPayload = {}, ledgerRow = null) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Subscription edit preview dependencies are not available.');
    }

    const row = ledgerRow || await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }
    const packMode = Boolean(requestPayload.delivery_id);
    if (packMode) assertPackOnlyChange(requestPayload, row);
    const payload = packMode ? withStoredPets(requestPayload, row.planSelection) : requestPayload;
    const currentTerm = Number(row.subscriptionTermMonths || 1);
    const shipping = verifiedEditShipping(this.shippingQuoteSigner, row, payload);

    const stripeBilling = resolveStripeBilling(this, ledgerStripeAccount(row));
    const subscription = await stripeBilling.retrieveSubscription(subscriptionId);
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
      prorationInvoice = await stripeBilling.previewProration({
        subscriptionId,
        items: itemUpdates,
        ...(packMode ? { prorationBehavior: 'none' } : {})
      });
    } catch (_error) {
      prorationInvoice = {};
    }

    const currency = proposed.currency || 'USD';
    const shippingCost = shippingCostFrom(shipping);
    // A pack change prices merchandise from the catalog lines, so a zero line is never rounded up to one pack.
    const nextCycle = packMode
      ? {
        subtotal: proposed.catalogSubtotal,
        tax: 0,
        total: roundMoney(proposed.catalogSubtotal + shippingCost),
        currency: String(currency).toUpperCase()
      }
      : await this.buildNextCycle({
        payload,
        proposed,
        shippingCost,
        currency,
        stripeBilling
      });

    const proposedTerm = Number(payload.subscription_term_months || currentTerm);

    return {
      subscription_id: subscriptionId,
      stripe_account: ledgerStripeAccount(row),
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
      proration: packMode ? NO_PRORATION(currency) : mapProrationFromInvoice(prorationInvoice, currency),
      next_cycle: nextCycle,
      ...(packMode
        ? {
          packs: buildPackAdjustment({
            deliveryId: payload.delivery_id,
            payload,
            resolved: proposed.resolved,
            currentSelection: row.planSelection,
            catalogItems: await this.loadCatalogItems(proposed.country),
            language: ledgerStripeAccount(row) === 'br' ? 'pt' : 'en',
            currency
          })
        }
        : {}),
      discount: {
        eligible: false,
        reason: 'edit_no_first_purchase_promo',
        percent: 0
      }
    };
  }

  async loadCatalogItems(country) {
    if (!this.planPreviewRepository || typeof this.planPreviewRepository.loadCatalogItems !== 'function') {
      return [];
    }
    return this.planPreviewRepository.loadCatalogItems(resolveMarket({ country }));
  }

  async buildNextCycle({ payload, proposed, shippingCost, currency, stripeBilling }) {
    const billing = stripeBilling || this.stripeBilling;
    const country = countryFromPayload(payload);
    if (billing && billing.previewSubscriptionInvoice && (country === 'US' || country === 'BR')) {
      const preview = await billing.previewSubscriptionInvoice({
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
