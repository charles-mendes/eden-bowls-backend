const { HttpError } = require('../../core/http-error');

function registerOnboardingSubscriptionPreviewRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/subscription/preview', async (request, response, next) => {
    try {
      if (!dependencies.onboardingSubscriptionPreviewService) {
        throw new HttpError(503, 'Onboarding subscription preview service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingSubscriptionPreviewService.preview({
        userId: request.currentUser.id,
        payload: request.body || {},
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
  registerOnboardingSubscriptionPreviewRoutes
};
