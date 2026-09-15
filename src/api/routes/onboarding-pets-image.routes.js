const { HttpError } = require('../../core/http-error');
const { parseRequestMarket } = require('../validators/market.validator');

function registerOnboardingPetImageRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/pets/:petId/image', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetImageService) {
        throw new HttpError(503, 'Onboarding pet image service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const market = parseRequestMarket(request, request.body || {});
      const result = await dependencies.onboardingPetImageService.uploadImage({
        userId: request.currentUser.id,
        petId: request.params.petId,
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

  app.delete('/api/v1/onboarding/pets/:petId/image', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetImageService) {
        throw new HttpError(503, 'Onboarding pet image service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const market = parseRequestMarket(request, request.body || {});
      const result = await dependencies.onboardingPetImageService.deleteImage({
        userId: request.currentUser.id,
        petId: request.params.petId,
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
  registerOnboardingPetImageRoutes
};
