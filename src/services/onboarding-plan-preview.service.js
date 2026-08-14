const { HttpError } = require('../core/http-error');
const crypto = require('crypto');

const DEFAULT_QUOTE_TTL_SECONDS = 10 * 60;

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

class OnboardingPlanPreviewService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.quotesRepository = options.quotesRepository || null;
    this.quoteTtlSeconds = Number(options.quoteTtlSeconds || DEFAULT_QUOTE_TTL_SECONDS);
  }

  async previewPlan({ userId = null, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding plan preview repository is not available.');
    }

    if (!this.quotesRepository) {
      throw new HttpError(503, 'Onboarding quotes repository is not available.');
    }

    const data = await this.repository.previewPlan(userId, payload);
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
  hashPayload
};
