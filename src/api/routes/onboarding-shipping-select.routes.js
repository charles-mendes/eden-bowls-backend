const { HttpError } = require('../../core/http-error');

function registerOnboardingShippingSelectRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/shipping', async (request, response, next) => {
    try {
      if (!dependencies.onboardingShippingSelectService) {
        throw new HttpError(503, 'Onboarding shipping select service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingShippingSelectService.selectShipping({
        userId: request.currentUser.id,
        payload: request.body || {},
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
  registerOnboardingShippingSelectRoutes
};
