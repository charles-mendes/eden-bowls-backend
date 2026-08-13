const { HttpError } = require('../../core/http-error');

function registerOnboardingPetsRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/pets', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetsService) {
        throw new HttpError(503, 'Onboarding pets service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingPetsService.listPets({
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
  registerOnboardingPetsRoutes
};
