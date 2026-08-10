const { HttpError } = require('../../core/http-error');
const { parseOnboardingPetUpdateInput } = require('../validators/onboarding-pets-update.validator');

function registerOnboardingPetUpdateRoutes(app, dependencies = {}) {
  app.patch('/api/v1/onboarding/session/:sessionId/pets/:petId', async (request, response, next) => {
    try {
      const sessionToken = String(request.headers['x-session-token'] || '').trim();
      const authorization = String(request.headers.authorization || '').trim();
      const hasSessionToken = Boolean(sessionToken || authorization);

      if (!hasSessionToken) {
        response.status(401).json({
          success: false,
          message: 'Session access token is required.'
        });
        return;
      }

      if (!dependencies.onboardingPetUpdateService) {
        throw new HttpError(503, 'Onboarding pet update service is not available.');
      }

      const payload = parseOnboardingPetUpdateInput(request.body || {});
      const result = await dependencies.onboardingPetUpdateService.updatePet({
        sessionId: request.params.sessionId,
        petId: request.params.petId,
        payload,
        currentUser: request.currentUser,
        sessionToken
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
