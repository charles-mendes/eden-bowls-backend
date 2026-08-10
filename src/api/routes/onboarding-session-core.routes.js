const { HttpError } = require('../../core/http-error');

function registerOnboardingSessionCoreRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/session/start', async (request, response, next) => {
    try {
      if (!dependencies.onboardingSessionCoreService) {
        throw new HttpError(503, 'Onboarding session core service is not available.');
      }

      const result = await dependencies.onboardingSessionCoreService.startSession({
        payload: request.body || {}
      });

      response.status(201).json(result);
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

  app.get('/api/v1/onboarding/session/:sessionId', async (request, response, next) => {
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

      if (!dependencies.onboardingSessionCoreService) {
        throw new HttpError(503, 'Onboarding session core service is not available.');
      }

      const result = await dependencies.onboardingSessionCoreService.getSessionSnapshot({
        sessionId: request.params.sessionId,
        sessionToken,
        currentUser: request.currentUser
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

  app.post('/api/v1/onboarding/session/:sessionId/token/refresh', async (request, response, next) => {
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

      if (!dependencies.onboardingSessionCoreService) {
        throw new HttpError(503, 'Onboarding session core service is not available.');
      }

      const result = await dependencies.onboardingSessionCoreService.refreshSessionToken({
        sessionId: request.params.sessionId,
        sessionToken,
        currentUser: request.currentUser,
        payload: request.body || {}
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

  app.post('/api/v1/onboarding/session/:sessionId/account-link', async (request, response, next) => {
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

      if (!dependencies.onboardingSessionCoreService) {
        throw new HttpError(503, 'Onboarding session core service is not available.');
      }

      const result = await dependencies.onboardingSessionCoreService.linkAccount({
        sessionId: request.params.sessionId,
        sessionToken,
        currentUser: request.currentUser,
        payload: request.body || {}
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
  registerOnboardingSessionCoreRoutes
};
