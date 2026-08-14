const { HttpError } = require('../../core/http-error');
const { parseOnboardingPetsSyncInput } = require('../validators/onboarding-pets-sync.validator');

function registerOnboardingPetsSyncRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/pets/sync', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPetsSyncService) {
        throw new HttpError(503, 'Onboarding pets sync service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const payload = parseOnboardingPetsSyncInput(request.body || {});
      const result = await dependencies.onboardingPetsSyncService.syncPets({
        userId: request.currentUser.id,
        payload
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({ success: false, message: error.message });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingPetsSyncRoutes
};