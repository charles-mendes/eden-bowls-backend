const { HttpError } = require('../../core/http-error');

function registerSubscriptionsRoutes(app, dependencies = {}) {
  app.get('/api/v1/subscriptions', async (request, response, next) => {
    try {
      if (!dependencies.subscriptionsService) {
        throw new HttpError(503, 'Subscriptions service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.subscriptionsService.listMine({
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
  registerSubscriptionsRoutes
};
