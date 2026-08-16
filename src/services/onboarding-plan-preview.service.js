const { HttpError } = require('../core/http-error');
const crypto = require('crypto');
const { buildPlanPreviewResponse, throwPlanError } = require('../core/plan-catalog-pricing');

const DEFAULT_QUOTE_TTL_SECONDS = 10 * 60;
const ALLOWED_SUBSCRIPTION_TERMS = new Set([1, 3, 6]);

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }

  return value;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function validateSubscriptionTerm(payload) {
  if (!ALLOWED_SUBSCRIPTION_TERMS.has(Number(payload && payload.subscription_term_months))) {
    throwPlanError(422, 'invalid_subscription_term', 'Subscription term must be 1, 3, or 6 months.');
  }
}

function validatePreviewPayload(payload) {
  const errors = {};
  const pets = Array.isArray(payload && payload.pets) ? payload.pets : [];

  pets.forEach((pet, index) => {
    if (!pet || typeof pet !== 'object' || pet.enabled === false) {
      return;
    }

    const flavors = Array.isArray(pet.selected_flavors) ? pet.selected_flavors : [];
    const weights = pet.flavor_weights;
    const fieldPrefix = `pets.${index}`;

    if (flavors.length === 0) {
      errors[`${fieldPrefix}.selected_flavors`] = 'At least one flavor is required.';
      return;
    }

    if (!Array.isArray(weights) || weights.length !== flavors.length) {
      errors[`${fieldPrefix}.flavor_weights`] = 'Flavor weights must match the selected flavors.';
      return;
    }

    const hasPositiveWeight = weights.some((weight) => Number.isFinite(Number(weight)) && Number(weight) > 0);
    if (!hasPositiveWeight) {
      errors[`${fieldPrefix}.flavor_weights`] = 'At least one flavor weight must be greater than zero.';
    }
  });

  if (Object.keys(errors).length > 0) {
    throwPlanError(422, 'invalid_plan_preview_payload', 'Plan preview payload is invalid.', errors);
  }

  const enabledPets = pets.filter((pet) => pet && typeof pet === 'object' && pet.enabled !== false);
  if (enabledPets.length === 0) {
    throwPlanError(422, 'invalid_plan_selection', 'At least one enabled pet is required.');
  }
}

class OnboardingPlanPreviewService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.quotesRepository = options.quotesRepository || null;
    this.quoteTtlSeconds = Number(options.quoteTtlSeconds || DEFAULT_QUOTE_TTL_SECONDS);
  }

  async previewPlan({ userId = null, payload, market }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan preview repository is not available.');
    }

    if (!this.quotesRepository) {
      throw new HttpError(503, 'Onboarding quotes repository is not available.');
    }

    validateSubscriptionTerm(payload);
    validatePreviewPayload(payload);

    const resolved = await this.repository.previewPlan(userId, payload, market);
    const data = buildPlanPreviewResponse(resolved);
    const expiresAt = new Date(Date.now() + this.quoteTtlSeconds * 1000);
    const payloadHash = hashPayload(payload);
    const quote = await this.quotesRepository.createQuote({
      id: `q_${crypto.randomUUID().replace(/-/g, '')}`,
      userId: userId || null,
      payloadHash,
      payload,
      pricing: data,
      expiresAt
    });

    return {
      success: true,
      data: {
        ...data,
        quote_id: quote.id,
        quote_expires_at: expiresAt.toISOString(),
        quote_payload_hash: payloadHash
      }
    };
  }
}

module.exports = {
  OnboardingPlanPreviewService,
  canonicalize,
  hashPayload,
  validatePreviewPayload,
  validateSubscriptionTerm
};
