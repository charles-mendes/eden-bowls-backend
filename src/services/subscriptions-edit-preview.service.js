const { HttpError } = require('../core/http-error');
const { parseSubscriptionsEditPreviewInput } = require('../api/validators/subscriptions-edit.validator');
const { validatePreviewPayload, validateSubscriptionTerm } = require('./onboarding-plan-preview.service');
const { assertSomePacks } = require('../core/pack-adjustment');

class SubscriptionsEditPreviewService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.ledgerRepository = options.ledgerRepository || null;
  }

  async preview({ subscriptionId, payload = {}, userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions edit preview repository is not available.');
    }

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const parsed = parseSubscriptionsEditPreviewInput(payload);
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
    if (this.ledgerRepository && !row) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }
    this.assertEditable(row);

    if (row) {
      await this.assertPetsNotBlocked(userId, subscriptionId, parsed.pets);
    }

    const data = await this.repository.preview(userId, subscriptionId, parsed, row);

    return {
      success: true,
      data
    };
  }

  assertEditable(row) {
    if (!row) {
      return;
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
  SubscriptionsEditPreviewService
};
