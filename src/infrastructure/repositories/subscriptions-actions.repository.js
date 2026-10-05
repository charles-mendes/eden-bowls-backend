const { HttpError } = require('../../core/http-error');
const { extractCardFromPaymentMethod } = require('../../core/stripe-subscription-map');
const { mapLedgerToActionSummary } = require('../../core/subscription-dashboard');
const { ledgerStripeAccount } = require('../../core/stripe-account');
const { resolveStripeBilling } = require('../stripe/stripe-accounts');
const {
  lastContractedDeliveryCharged,
  resolveAutoRenew,
  stripeChargedInvoiceCount
} = require('../../core/contract-deliveries');

class SubscriptionsActionsRepository {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.deliveries = options.deliveries || null;
    this.transactionalMailer = options.transactionalMailer || null;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.now = options.now || (() => new Date());
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
        : !resolveAutoRenew(row);
      // With renewal off, the contract ends after its last contracted delivery, not at this period's end.
      const endNow = enabled ? false : await this.lastDeliveryCharged(row, stripeBilling);
      await stripeBilling.setCancelAtPeriodEnd(subscriptionId, endNow);
      if (typeof this.ledgerRepository.setAutoRenew === 'function') {
        await this.ledgerRepository.setAutoRenew(subscriptionId, enabled);
      }
      if (!enabled && resolveAutoRenew(row)) {
        await this.notifyAutoRenewOff(userId, subscriptionId);
      }
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

  // Sent at once, with the last contracted delivery from the deliveries read (renewal is already off there).
  // A failure is logged and does not undo the action.
  async notifyAutoRenewOff(userId, subscriptionId) {
    if (!this.transactionalMailer || typeof this.transactionalMailer.notifyAutoRenewOff !== 'function') {
      return;
    }
    try {
      let endsOn = null;
      if (this.deliveries) {
        const subscription = await this.deliveries.loadSubscription(subscriptionId, userId);
        const read = await this.deliveries.read(subscription, userId);
        endsOn = read.contractEnd || null;
      }
      if (!endsOn) {
        this.logger.warn({ subscriptionId }, 'Automatic renewal off: the contract end is unknown, the email omits the date.');
      }
      const ledger = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
      await this.transactionalMailer.notifyAutoRenewOff({
        ledger: ledger || {},
        subscriptionId,
        referenceId: `auto_renew_off:${this.now().toISOString()}`,
        endsOn
      });
    } catch (error) {
      this.logger.error({ subscriptionId, code: error && error.code }, 'Automatic renewal off email failed.');
    }
  }

  async lastDeliveryCharged(row, stripeBilling) {
    let paid = row.chargedDeliveries;
    if (paid == null) {
      const invoices = await stripeBilling.listPaidInvoicesForSubscription(row.stripeSubscriptionId);
      paid = stripeChargedInvoiceCount(invoices);
    }
    const plan = row.planSelection || {};
    const term = Number(row.subscriptionTermMonths || plan.subscription_term_months || 1) || 1;
    return lastContractedDeliveryCharged(paid, term);
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
