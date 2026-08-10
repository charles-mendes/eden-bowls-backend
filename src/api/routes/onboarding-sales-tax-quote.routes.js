const { HttpError } = require('../../core/http-error');

function registerOnboardingSalesTaxQuoteRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/session/:sessionId/sales-tax/quote', async (request, response, next) => {
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

      if (!dependencies.onboardingSalesTaxQuoteService) {
        throw new HttpError(503, 'Onboarding sales tax quote service is not available.');
      }

      const result = await dependencies.onboardingSalesTaxQuoteService.quote({
        sessionId: request.params.sessionId,
        payload: request.body || {},
        currentUser: request.currentUser,
        sessionToken
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message,
          details: error.details
        });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingSalesTaxQuoteRoutes
};
