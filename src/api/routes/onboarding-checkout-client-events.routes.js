const { HttpError } = require('../../core/http-error');
const { CORRELATION_HEADER, currencyForMarket } = require('../../core/purchase-trail');
const { pageMarket } = require('../middleware/purchase-trail.middleware');

// stripe_account_check: the checkout answered for another Stripe account than the page's; only the browser sees it.
const STEPS = new Set(['retrieve_payment_intent', 'confirm_card_payment', 'payment_intent_ack', 'stripe_account_check']);

function text(value, max) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).slice(0, max);
}

// Only these keys are read; anything else the store sends (a Stripe error object, client_secret, payment_method)
// is dropped, never stored and never refused.
function parseClientEvent(body = {}) {
  const step = String(body.step || '').trim();
  const outcome = String(body.outcome || '').trim();
  if (!STEPS.has(step) || (outcome !== 'ok' && outcome !== 'failed')) {
    return null;
  }
  return {
    step,
    outcome,
    stripeCode: text(body.stripe_code, 64),
    stripeType: text(body.stripe_type, 64),
    stripeParam: text(body.stripe_param, 128),
    code: text(body.code, 64),
    message: text(body.message, 500),
    attemptId: text(body.attempt_id, 128),
    correlationId: text(body.correlation_id, 36)
  };
}

// customer-purchase-trail: what the store saw in the browser (retrievePaymentIntent, confirmCardPayment) and a
// failed payment-intent/ack the store swallows on purpose. 202 whether the trail wrote or not: the checkout never
// waits on it. A browser report never marks an attempt paid: only the ack or a resolved webhook does.
function registerOnboardingCheckoutClientEventsRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/checkout/client-events', async (request, response, next) => {
    try {
      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }
      const event = parseClientEvent(request.body || {});
      if (!event) {
        throw new HttpError(400, 'Invalid client event.', { code: 'invalid_client_event' });
      }

      const trail = dependencies.customerPurchaseTrailService;
      if (trail) {
        try {
          const userId = request.currentUser.id;
          const market = await trail.resolveCustomerMarket(userId, pageMarket(request));
          if (market) {
            let correlationId = event.correlationId || (request.headers && request.headers[CORRELATION_HEADER]);
            if (!correlationId && event.attemptId) {
              const attempt = await trail.findAttemptByAttemptId({ userId, market, attemptId: event.attemptId });
              correlationId = attempt ? attempt.correlation_id : null;
            }
            await trail.recordStep({
              userId,
              email: request.currentUser.email || request.currentUser.user_email,
              market,
              correlationId,
              area: 'checkout',
              step: event.step,
              outcome: event.outcome,
              // Only a declined confirmation ends the attempt from here; it never reaches the server otherwise.
              transition: event.step === 'confirm_card_payment' && event.outcome === 'failed' ? 'failed' : null,
              fields: { attemptId: event.attemptId, currency: currencyForMarket(market) },
              error: event.outcome === 'failed' ? {
                code: event.code || event.stripeCode || `${event.step}_failed`,
                message: event.message,
                stripeCode: event.stripeCode,
                stripeType: event.stripeType,
                stripeParam: event.stripeParam
              } : {}
            });
          }
        } catch (error) {
          if (dependencies.logger && typeof dependencies.logger.warn === 'function') {
            dependencies.logger.warn({ message: String(error && error.message || '') }, 'Purchase trail client event failed.');
          }
        }
      }

      response.status(202).json({ success: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerOnboardingCheckoutClientEventsRoutes,
  parseClientEvent
};
