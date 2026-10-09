const { HttpError } = require('../core/http-error');
const { parseSubscriptionsEditCommitInput } = require('../api/validators/subscriptions-edit.validator');
const { validatePreviewPayload, validateSubscriptionTerm } = require('./onboarding-plan-preview.service');
const { assertSomePacks } = require('../core/pack-adjustment');

class SubscriptionsEditCommitService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.deliveryGuard = options.deliveryGuard || null;
  }

  async commit({ subscriptionId, payload = {}, userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions edit commit repository is not available.');
    }

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!this.authService) {
      throw new HttpError(503, 'Auth service is not available for critical operations.');
    }

    await this.authService.assertCriticalOperationAllowed(userId);

    const parsed = parseSubscriptionsEditCommitInput(payload);
    validateSubscriptionTerm(parsed);
    if (parsed.delivery_id) {
      assertSomePacks(parsed);
    }
    try {
      validatePreviewPayload(parsed);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new HttpError(422, error.message, {
          code: 'invalid_plan',
          errors: error.details && error.details.errors
        });
      }
      throw error;
    }

    const row = this.ledgerRepository
      ? await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId)
      : null;
    if (!row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }
    if (row.status === 'canceled') {
      throw new HttpError(422, 'This subscription cannot be edited.', {
        code: 'subscription_not_editable'
      });
    }
    if (row.editPaymentPending) {
      throw new HttpError(409, 'An edit payment is still pending.', {
        code: 'edit_payment_pending'
      });
    }

    await this.assertPetsNotBlocked(userId, subscriptionId, parsed.pets);
    let guard = null;
    if (parsed.delivery_id) {
      guard = await this.assertDeliveryEditable(userId, subscriptionId, parsed.delivery_id);
    }

    // The following delivery's packs wait for the current delivery's invoice, so that charge keeps its packs.
    if (guard && guard.deferred) {
      const prepared = await this.repository.commit(userId, subscriptionId, parsed, row, { defer: true });
      await this.deliveryGuard.recordPendingPacks(guard.subscription, userId, {
        payload: parsed,
        packs_per_month: prepared.packs_per_month,
        subtotal: prepared.subtotal
      });
      return {
        success: true,
        data: { ...prepared, pending_until_current_charge: true }
      };
    }

    const data = await this.repository.commit(userId, subscriptionId, parsed, row);

    return {
      success: true,
      data
    };
  }

  // Rejects with delivery_locked once the market clock is past editable_until or production has started.
  async assertDeliveryEditable(userId, subscriptionId, deliveryId) {
    if (!this.deliveryGuard) {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const subscription = await this.deliveryGuard.loadSubscription(subscriptionId, userId);
    const guard = await this.deliveryGuard.commitPacks(subscription, userId, { deliveryId });
    return { subscription, deferred: Boolean(guard && guard.deferred) };
  }

  async assertPetsNotBlocked(userId, subscriptionId, pets) {
    if (!this.ledgerRepository) {
      return;
    }

    const enabledIds = (Array.isArray(pets) ? pets : [])
      .filter((pet) => pet && pet.enabled !== false)
      .map((pet) => String(pet.pet_id || ''))
      .filter(Boolean);
    if (enabledIds.length === 0) {
      return;
    }

    const others = await this.ledgerRepository.listByUserId(userId);
    for (const other of others) {
      if (other.stripeSubscriptionId === subscriptionId) {
        continue;
      }
      if (!['active', 'trialing'].includes(other.status)) {
        continue;
      }
      const ids = other.petsSnapshot && Array.isArray(other.petsSnapshot.pet_ids)
        ? other.petsSnapshot.pet_ids.map(String)
        : [];
      if (enabledIds.some((id) => ids.includes(id))) {
        throw new HttpError(422, 'A selected pet already belongs to another active subscription.', {
          code: 'pet_blocked'
        });
      }
    }
  }
}

module.exports = {
  SubscriptionsEditCommitService
};
