// Canonical list of the events each Stripe webhook endpoint subscribes to (US and BR, test and live).
// Section 8 of docs-new/FEATURE_STRIPE_SEPARAR_PAISES/COMO-CONFIGURAR-STRIPE.md mirrors this list for the
// dashboard; tests/stripe-webhook-events.test.js fails when the two differ.
const STRIPE_WEBHOOK_EVENTS = Object.freeze([
  'charge.dispute.closed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.refund.updated',
  'charge.refunded',
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.created',
  'customer.deleted',
  'customer.subscription.created',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
  'customer.subscription.updated',
  'customer.updated',
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_action_required',
  'invoice.payment_failed',
  'payment_intent.canceled',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_method.attached',
  'payment_method.detached',
  'refund.created',
  'refund.updated'
]);

const SUBSCRIBED_EVENTS = new Set(STRIPE_WEBHOOK_EVENTS);

function isSubscribedStripeEvent(type) {
  return SUBSCRIBED_EVENTS.has(String(type || ''));
}

module.exports = {
  STRIPE_WEBHOOK_EVENTS,
  isSubscribedStripeEvent
};
