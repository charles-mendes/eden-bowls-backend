const { HttpError } = require('../../core/http-error');
const { extractCardFromPaymentMethod } = require('../../core/stripe-subscription-map');
const { mapLedgerToActionSummary } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');

class SubscriptionsActionsRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
  }

  async executeAction(userId, subscriptionId, payload = {}) {
    if (!this.ledgerRepository) {
      throw new HttpError(503, 'Subscription ledger is not available.');
    }

    const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }

    const stripeBilling = resolveStripeBilling(this, ledgerStripeAccount(row));

    const action = payload.action;
    if (action === 'pause') {
      await stripeBilling.pauseSubscription(subscriptionId);
    } else if (action === 'reactivate') {
      await stripeBilling.resumeSubscription(subscriptionId);
    } else if (action === 'cancel') {
      // Cancel at period end so the current cycle remains usable until Stripe confirms via webhook.
      await stripeBilling.cancelSubscription(subscriptionId);
    } else if (action === 'toggle_auto_renew') {
      const enabled = typeof payload.enabled === 'boolean'
        ? payload.enabled
        : row.cancelAtPeriodEnd;
      await stripeBilling.setCancelAtPeriodEnd(subscriptionId, !enabled);
    } else if (action === 'update_payment_method') {
      await stripeBilling.updateDefaultPaymentMethod(
        row.stripeCustomerId,
        payload.payment_method_id,
        subscriptionId
      );
      await this.updateCardSnapshot(row, payload.payment_method_id, stripeBilling);
    }

    const latest = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
    return {
      action,
      pending_webhook_confirmation: true,
      command_result: [{ status: 'queued' }],
      subscription: mapLedgerToActionSummary(latest || row)
    };
  }

  async updateCardSnapshot(row, paymentMethodId, stripeBilling) {
    const billing = stripeBilling || this.stripeBilling;
    if (!billing || !billing.client || !billing.client.paymentMethods) {
      return;
    }

    try {
      const paymentMethod = await billing.client.paymentMethods.retrieve(paymentMethodId);
      const card = extractCardFromPaymentMethod(paymentMethod);
      if (!card.last4 && !card.brand) {
        return;
      }
      await this.ledgerRepository.upsert({
        userId: row.userId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        stripeCustomerId: row.stripeCustomerId,
        status: row.status,
        paymentMethodLast4: card.last4 || row.paymentMethodLast4,
        paymentMethodBrand: card.brand || row.paymentMethodBrand
      });
    } catch (_error) {
      // optimistic last4 is optional
    }
  }
}

module.exports = {
  SubscriptionsActionsRepository
};
