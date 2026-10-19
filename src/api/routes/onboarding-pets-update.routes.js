const { HttpError } = require('../../core/http-error');
const { parseRequestMarket } = require('../validators/market.validator');
const { parseOnboardingPetUpdateInput } = require('../validators/onboarding-pets-update.validator');

function registerOnboardingPetUpdateRoutes(app, dependencies = {}) {
  app.patch('/api/v1/onboarding/pets/:petId', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetUpdateService) {
        throw new HttpError(503, 'Onboarding pet update service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const market = parseRequestMarket(request, request.body || {});
      const payload = parseOnboardingPetUpdateInput(request.body || {});
      const result = await dependencies.onboardingPetUpdateService.updatePet({
        userId: request.currentUser.id,
        petId: request.params.petId,
        payload,
        market
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        // The confirmation needs the new stage and the affected plans; other errors keep their short body.
        const body = { success: false, message: error.message };
        if (error.details.code === 'life_stage_change_requires_confirmation') {
          body.details = error.details;
        }
        response.status(error.statusCode).json(body);
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingPetUpdateRoutes
};
