const { HttpError } = require('../../core/http-error');

function registerOnboardingRecommendationRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/session/:sessionId/recommendation', async (request, response, next) => {
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

      if (!dependencies.onboardingRecommendationService) {
        throw new HttpError(503, 'Onboarding recommendation service is not available.');
      }

      const result = await dependencies.onboardingRecommendationService.getRecommendation({
        sessionId: request.params.sessionId,
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
  registerOnboardingRecommendationRoutes
};
