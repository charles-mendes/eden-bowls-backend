const { z } = require('zod');

const paymentIntentAckPayloadSchema = z.object({
  payment_intent_id: z.string().trim().min(1).optional(),
  paymentIntentId: z.string().trim().min(1).optional(),
  payment_intent_status: z.string().trim().min(1).optional(),
  paymentIntentStatus: z.string().trim().min(1).optional()
});

function parsePaymentIntentAckInput(payload = {}) {
  const parsed = paymentIntentAckPayloadSchema.parse(payload || {});
  const paymentIntentId = parsed.payment_intent_id || parsed.paymentIntentId || '';
  const paymentIntentStatus = parsed.payment_intent_status || parsed.paymentIntentStatus || '';

  return {
    paymentIntentId,
    paymentIntentStatus
  };
}

module.exports = {
  parsePaymentIntentAckInput
};
