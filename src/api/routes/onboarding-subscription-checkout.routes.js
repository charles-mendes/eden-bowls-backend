const { HttpError } = require('../../core/http-error');
const { parseOnboardingSubscriptionCheckoutInput } = require('../validators/onboarding-subscription-checkout.validator');

function registerOnboardingSubscriptionCheckoutRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/subscription/checkout', async (request, response, next) => {
    try {
      if (!dependencies.onboardingSubscriptionCheckoutService) {
        throw new HttpError(503, 'Onboarding subscription checkout service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const payload = parseOnboardingSubscriptionCheckoutInput(request.body || {}, {
        idempotencyKey: request.get('Idempotency-Key')
      });
      const result = await dependencies.onboardingSubscriptionCheckoutService.checkout({
        userId: request.currentUser.id,
        payload
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message,
          details: error.details
        });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingSubscriptionCheckoutRoutes
};
