const { HttpError } = require('../../core/http-error');

function registerOnboardingDiscountEligibilityRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/discount/eligibility', async (request, response, next) => {
    try {
      if (!dependencies.onboardingDiscountEligibilityService) {
        throw new HttpError(503, 'Onboarding discount eligibility service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingDiscountEligibilityService.getEligibility({
        userId: request.currentUser.id
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
  registerOnboardingDiscountEligibilityRoutes
};