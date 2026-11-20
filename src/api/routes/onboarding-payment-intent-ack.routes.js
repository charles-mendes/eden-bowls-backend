const { HttpError } = require('../../core/http-error');
const { parsePaymentIntentAckInput } = require('../validators/onboarding-payment-intent-ack.validator');

function registerOnboardingPaymentIntentAckRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/payment-intent/ack', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPaymentIntentAckService) {
        throw new HttpError(503, 'Onboarding payment intent ack service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const payload = parsePaymentIntentAckInput(request.body || {});
      const result = await dependencies.onboardingPaymentIntentAckService.acknowledge({
        userId: request.currentUser.id,
        payload,
      });

      response.status(200).json(result);
    } catch (error) {
      // customer-purchase-trail reads the code here: some answers below leave it out of the body.
      response.locals.purchaseTrailError = error;
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message
        });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingPaymentIntentAckRoutes
};
