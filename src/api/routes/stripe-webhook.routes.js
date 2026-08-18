const { HttpError } = require('../../core/http-error');

function registerStripeWebhookRoutes(app, dependencies = {}) {
  app.post('/stripe/v1/webhook', async (request, response, next) => {
    try {
      if (!dependencies.stripeWebhookService) {
        throw new HttpError(503, 'Stripe webhook service is not available.', {
          code: 'stripe_webhook_unavailable'
        });
      }

      const result = await dependencies.stripeWebhookService.handle({
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
}

module.exports = {
  registerStripeWebhookRoutes
};
