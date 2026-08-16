const { HttpError } = require('../../core/http-error');
const { parseRequestMarket } = require('../validators/market.validator');
const { parseOnboardingRecommendationPetsInput } = require('../validators/onboarding-recommendation-pets.validator');

function registerOnboardingRecommendationRoutes(app, dependencies = {}) {
  async function handleRecommendation(request, response, next, pets) {
    try {
      if (!dependencies.onboardingRecommendationService) {
        throw new HttpError(503, 'Onboarding recommendation service is not available.');
      }

      const market = parseRequestMarket(request, request.body || {});
      const result = await dependencies.onboardingRecommendationService.getRecommendation({
        userId: request.currentUser && request.currentUser.id ? request.currentUser.id : null,
        market,
        pets
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
  }

  app.get('/api/v1/onboarding/recommendation', (request, response, next) => {
    void handleRecommendation(request, response, next);
  });

  app.post('/api/v1/onboarding/recommendation', (request, response, next) => {
    const payload = parseOnboardingRecommendationPetsInput(request.body || {});
    void handleRecommendation(request, response, next, payload.pets);
  });
}

module.exports = {
  registerOnboardingRecommendationRoutes
};
