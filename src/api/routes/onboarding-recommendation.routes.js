const { HttpError } = require('../../core/http-error');

function registerOnboardingRecommendationRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/recommendation', async (request, response, next) => {
    try {
      if (!dependencies.onboardingRecommendationService) {
        throw new HttpError(503, 'Onboarding recommendation service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingRecommendationService.getRecommendation({
        userId: request.currentUser.id
      });

      response.status(200).json(result);
    } catch (error) {
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
  registerOnboardingRecommendationRoutes
};
