const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const billingSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional()
}).passthrough();

const checkoutPayloadSchema = z.object({
  payment_method_id: z.string().trim().optional(),
  paymentMethodId: z.string().trim().optional(),
  billing: billingSchema.optional(),
  attempt_id: z.string().trim().min(1).max(128).optional()
});

function parseOnboardingSubscriptionCheckoutInput(payload = {}, headers = {}) {
  let parsed;
  try {
    parsed = checkoutPayloadSchema.parse(payload || {});
  } catch (error) {
    if (error && error.name === 'ZodError') {
      throw new HttpError(422, 'Invalid checkout payload.', {
        code: 'invalid_payment_method',
        issues: error.issues
      });
    }
    throw error;
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
    attempt_id: attemptId || undefined
  };
}

module.exports = {
  parseOnboardingSubscriptionCheckoutInput
};
