const { HttpError } = require('../../core/http-error');

function registerStripeWebhookRoutes(app, dependencies = {}) {
  const register = (path, account) => {
    app.post(path, async (request, response, next) => {
      try {
        if (!dependencies.stripeWebhookService) {
          throw new HttpError(503, 'Stripe webhook service is not available.', {
            code: 'stripe_webhook_unavailable'
          });
        }

        const result = await dependencies.stripeWebhookService.handle({
          account,
          rawBody: request.body,
          signature: request.headers['stripe-signature']
        });
        response.status(200).json(result);
      } catch (error) {
        if (error instanceof HttpError && (error.statusCode === 400 || error.statusCode === 503)) {
          response.status(error.statusCode).json({ received: false });
          return;
        }

        next(error);
      }
    });
  };

  register('/stripe/v1/webhook/br', 'br');
  register('/stripe/v1/webhook/us', 'us');
  register('/stripe/v1/webhook', 'us');
}

module.exports = {
  registerStripeWebhookRoutes
};
