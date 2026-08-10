const { HttpError } = require('../core/http-error');

const SUPPORTED_ACTIONS = ['pause', 'reactivate', 'cancel', 'toggle_auto_renew', 'change_plan', 'change_billing_frequency', 'update_payment_method'];

function normalizeAction(payload = {}) {
  const action = String(payload.action || '').trim().toLowerCase();
  if (!action) {
    throw new HttpError(422, 'Action is required.', { code: 'invalid_action' });
  }

  if (!SUPPORTED_ACTIONS.includes(action)) {
    throw new HttpError(422, 'Unsupported action.', { code: 'invalid_action' });
  }

  return action;
}

function normalizeEnabled(payload = {}) {
  if (typeof payload.enabled === 'boolean') {
    return payload.enabled;
  }

  return undefined;
}

class SubscriptionsActionsService {
  constructor(repository) {
    this.repository = repository;
  }

  async executeAction({ subscriptionId, payload = {}, currentUser, sessionToken }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions actions repository is not available.');
    }

    const action = normalizeAction(payload);

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!currentUser || !currentUser.id) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.executeAction(subscriptionId, {
      action,
      enabled: normalizeEnabled(payload),
      new_variation_id: payload.new_variation_id,
      new_product_id: payload.new_product_id,
      new_price_id: payload.new_price_id || payload.newPriceId,
      frequency: payload.frequency,
      proration_behavior: payload.proration_behavior || payload.prorationBehavior,
      payment_method_id: payload.payment_method_id || payload.paymentMethodId,
      request_fingerprint: payload.request_fingerprint || payload.requestFingerprint
    }, { currentUser, sessionToken });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  SubscriptionsActionsService,
  SUPPORTED_ACTIONS,
  normalizeAction,
  normalizeEnabled
};
