const { HttpError } = require('../../core/http-error');

function registerOnboardingZipcodeLookupRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/zipcode/lookup', async (request, response, next) => {
    try {
      if (!dependencies.onboardingZipcodeLookupService) {
        throw new HttpError(503, 'Onboarding zipcode lookup service is not available.');
      }

      const result = await dependencies.onboardingZipcodeLookupService.lookup({
        payload: request.body || {}
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
  registerOnboardingZipcodeLookupRoutes
};
