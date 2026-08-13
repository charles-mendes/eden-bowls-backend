const { HttpError } = require('../../core/http-error');

function registerOnboardingPlanSnapshotRoutes(app, dependencies = {}) {
  app.get('/api/v1/onboarding/plan/snapshot', async (request, response, next) => {
    try {
      if (!dependencies.onboardingPlanSnapshotService) {
        throw new HttpError(503, 'Onboarding plan snapshot service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.onboardingPlanSnapshotService.getSnapshot({
        userId: request.currentUser.id
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
  registerOnboardingPlanSnapshotRoutes
};
