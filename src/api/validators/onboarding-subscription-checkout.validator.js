const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const billingSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional()
}).passthrough();

// The box "I have read and agree to the Terms of Service and Privacy Policy" and the versions the store showed
// (legal-documents). `accepted` is checked by hand so that only a literal true passes.
const legalConsentSchema = z.object({
  accepted: z.unknown().optional(),
  terms_version: z.string().trim().max(32).optional(),
  privacy_version: z.string().trim().max(32).optional()
});

// The box "I agree to the automatic renewal of the plan" and the version of the renewal text the store showed
// (checkout-renewal-consent). Only a literal true passes, as with legal_consent.
const renewalConsentSchema = z.object({
  accepted: z.unknown().optional(),
  version: z.string().trim().max(32).optional()
});

const checkoutPayloadSchema = z.object({
  payment_method_id: z.string().trim().optional(),
  paymentMethodId: z.string().trim().optional(),
  billing: billingSchema.optional(),
  attempt_id: z.string().trim().min(1).max(128).optional(),
  legal_consent: legalConsentSchema.optional(),
  renewal_consent: renewalConsentSchema.optional(),
  tax_document: z.string().trim().max(32).optional(),
  fiscal_name: z.string().trim().optional()
});

function legalConsentRequired(issues) {
  return new HttpError(422, 'Accepting the Terms of Service and Privacy Policy is required.', {
    code: 'legal_consent_required',
    ...(issues ? { issues } : {})
  });
}

function renewalConsentRequired(issues) {
  return new HttpError(422, 'Accepting the automatic renewal is required.', {
    code: 'renewal_consent_required',
    ...(issues ? { issues } : {})
  });
}

function parseOnboardingSubscriptionCheckoutInput(payload = {}, headers = {}) {
  let parsed;
  try {
    parsed = checkoutPayloadSchema.parse(payload || {});
  } catch (error) {
    if (error && error.name === 'ZodError') {
      if (error.issues.some((issue) => issue.path[0] === 'legal_consent')) {
        throw legalConsentRequired(error.issues);
      }
      if (error.issues.some((issue) => issue.path[0] === 'renewal_consent')) {
        // A client without either box keeps getting legal_consent_required first.
        if ((payload || {}).legal_consent?.accepted !== true) throw legalConsentRequired();
        throw renewalConsentRequired(error.issues);
      }
      throw new HttpError(422, 'Invalid checkout payload.', {
        code: 'invalid_payment_method',
        issues: error.issues
      });
    }
    throw error;
  }

  // Checked before anything else of the checkout runs (legal-documents).
  const consent = parsed.legal_consent || {};
  if (consent.accepted !== true) {
    throw legalConsentRequired();
  }
  // After legal_consent, so a client without either box gets the answer it got before (checkout-renewal-consent).
  const renewal = parsed.renewal_consent || {};
  if (renewal.accepted !== true) {
    throw renewalConsentRequired();
  }

  const paymentMethodId = String(parsed.payment_method_id || parsed.paymentMethodId || '').trim();
  if (!paymentMethodId.startsWith('pm_')) {
    throw new HttpError(422, 'A valid payment method is required.', {
      code: 'invalid_payment_method'
    });
  }

  const headerAttemptId = String(headers.idempotencyKey || headers['idempotency-key'] || '').trim();
  const attemptId = String(parsed.attempt_id || headerAttemptId || '').trim();

  return {
    payment_method_id: paymentMethodId,
    paymentMethodId,
    billing: parsed.billing || {},
    attempt_id: attemptId || undefined,
    tax_document: parsed.tax_document || undefined,
    fiscal_name: parsed.fiscal_name || undefined,
    legal_consent: {
      accepted: true,
      terms_version: consent.terms_version || undefined,
      privacy_version: consent.privacy_version || undefined
    },
    renewal_consent: {
      accepted: true,
      version: renewal.version || undefined
    }
  };
}

module.exports = {
  parseOnboardingSubscriptionCheckoutInput
};
