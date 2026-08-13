const { HttpError } = require('../../core/http-error');

function registerOnboardingPlanPreviewRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/plan/preview', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPlanPreviewService) {
        throw new HttpError(503, 'Onboarding plan preview service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingPlanPreviewService.previewPlan({
        userId: request.currentUser.id,
        payload: request.body || {},
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
  registerOnboardingPlanPreviewRoutes
};
