const { HttpError } = require('../../core/http-error');
const { parseOnboardingPetCreateInput } = require('../validators/onboarding-pets-create.validator');

function registerOnboardingPetCreateRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/pets', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetCreateService) {
        throw new HttpError(503, 'Onboarding pet create service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const payload = parseOnboardingPetCreateInput(request.body || {});
      const result = await dependencies.onboardingPetCreateService.createPet({
        userId: request.currentUser.id,
        payload,
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
  registerOnboardingPetCreateRoutes
};
