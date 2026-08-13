const { HttpError } = require('../../core/http-error');

function registerSubscriptionsActionsRoutes(app, dependencies = {}) {
  app.post('/api/v1/subscriptions/:subscriptionId/actions', async (request, response, next) => {
    try {
      if (!dependencies.subscriptionsActionsService) {
        throw new HttpError(503, 'Subscriptions actions service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.subscriptionsActionsService.executeAction({
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
  registerSubscriptionsActionsRoutes
};
