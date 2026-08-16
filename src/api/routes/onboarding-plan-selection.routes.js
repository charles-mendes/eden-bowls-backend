const { HttpError } = require('../../core/http-error');
const { parseRequestMarket } = require('../validators/market.validator');

function registerOnboardingPlanSelectionRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/plan-selection', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPlanSelectionService) {
        throw new HttpError(503, 'Onboarding plan selection service is not available.');
      }

      const market = parseRequestMarket(request, request.body || {});
      const result = await dependencies.onboardingPlanSelectionService.setPlanSelection({
        userId: request.currentUser && request.currentUser.id ? request.currentUser.id : null,
        payload: request.body || {},
        market
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
  registerOnboardingPlanSelectionRoutes
};
