const { HttpError } = require('../../core/http-error');

function registerSubscriptionsDetailRoutes(app, dependencies = {}) {
  app.get('/api/v1/subscriptions/:subscriptionId/detail', async (request, response, next) => {
    try {
      if (!dependencies.subscriptionsDetailService) {
        throw new HttpError(503, 'Subscriptions detail service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.subscriptionsDetailService.getDetail({
        subscriptionId: request.params.subscriptionId,
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
  registerSubscriptionsDetailRoutes
};
