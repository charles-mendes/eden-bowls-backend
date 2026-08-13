const { HttpError } = require('../../core/http-error');

function registerOnboardingPetDeleteRoutes(app, dependencies = {}) {
  app.delete('/api/v1/onboarding/pets/:petId', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetDeleteService) {
        throw new HttpError(503, 'Onboarding pet delete service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingPetDeleteService.deletePet({
        userId: request.currentUser.id,
        petId: request.params.petId,
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
  registerOnboardingPetDeleteRoutes
};
