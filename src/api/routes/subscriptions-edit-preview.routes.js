const { HttpError } = require('../../core/http-error');

function registerSubscriptionsEditPreviewRoutes(app, dependencies = {}) {
  app.post('/api/v1/subscriptions/:subscriptionId/edit/preview', async (request, response, next) => {
    try {
      if (!dependencies.subscriptionsEditPreviewService) {
        throw new HttpError(503, 'Subscriptions edit preview service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.subscriptionsEditPreviewService.preview({
        subscriptionId: request.params.subscriptionId,
        payload: request.body || {},
        userId: request.currentUser.id
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
  registerSubscriptionsEditPreviewRoutes
};
