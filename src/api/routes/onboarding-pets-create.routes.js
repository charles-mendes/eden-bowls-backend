const { HttpError } = require('../../core/http-error');
const { parseOnboardingPetCreateInput } = require('../validators/onboarding-pets-create.validator');

function registerOnboardingPetCreateRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/session/:sessionId/pets', async (request, response, next) => {
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

      if (!dependencies.onboardingPetCreateService) {
        throw new HttpError(503, 'Onboarding pet create service is not available.');
      }

      const payload = parseOnboardingPetCreateInput(request.body || {});
      const result = await dependencies.onboardingPetCreateService.createPet({
        sessionId: request.params.sessionId,
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
  registerOnboardingPetCreateRoutes
};
