const { HttpError } = require('../../core/http-error');
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

      const payload = parseOnboardingPetUpdateInput(request.body || {});
      const result = await dependencies.onboardingPetUpdateService.updatePet({
        userId: request.currentUser.id,
        petId: request.params.petId,
        payload
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
  registerOnboardingPetUpdateRoutes
};
