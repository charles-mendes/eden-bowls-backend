const { HttpError } = require('../../core/http-error');

function registerSubscriptionsLifeStageNoticesRoutes(app, dependencies = {}) {
  app.post('/api/v1/subscriptions/:subscriptionId/life-stage-notices/:petId/dismiss', async (request, response, next) => {
    try {
      if (!dependencies.lifeStageNoticesService) {
        throw new HttpError(503, 'Life stage notices service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.lifeStageNoticesService.dismiss({
        userId: request.currentUser.id,
        subscriptionId: request.params.subscriptionId,
        petId: request.params.petId
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
  registerSubscriptionsLifeStageNoticesRoutes
};
