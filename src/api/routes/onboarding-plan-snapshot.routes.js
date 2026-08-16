const { HttpError } = require('../../core/http-error');
const { parseRequestMarket } = require('../validators/market.validator');
const { parseOnboardingRecommendationPetsInput } = require('../validators/onboarding-recommendation-pets.validator');

function registerOnboardingPlanSnapshotRoutes(app, dependencies = {}) {
  async function handleSnapshot(request, response, next, pets) {
    try {
      if (!dependencies.onboardingPlanSnapshotService) {
        throw new HttpError(503, 'Onboarding plan snapshot service is not available.');
      }

      const market = parseRequestMarket(request, request.body || {});
      const result = await dependencies.onboardingPlanSnapshotService.getSnapshot({
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

  app.get('/api/v1/onboarding/plan/snapshot', (request, response, next) => {
    void handleSnapshot(request, response, next);
  });

  app.post('/api/v1/onboarding/plan/snapshot', (request, response, next) => {
    const payload = parseOnboardingRecommendationPetsInput(request.body || {});
    void handleSnapshot(request, response, next, payload.pets);
  });
}

module.exports = {
  registerOnboardingPlanSnapshotRoutes
};
