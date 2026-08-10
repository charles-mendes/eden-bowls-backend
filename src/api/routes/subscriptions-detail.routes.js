const { HttpError } = require('../../core/http-error');

function registerSubscriptionsDetailRoutes(app, dependencies = {}) {
  app.get('/api/v1/subscriptions/:subscriptionId/detail', async (request, response, next) => {
    try {
      const authorization = String(request.headers.authorization || '').trim();
      const hasAuthentication = Boolean(request.currentUser || request.auth || authorization || request.headers['x-session-token']);

      if (!hasAuthentication) {
        response.status(401).json({
          success: false,
          message: 'Authentication is required.'
        });
        return;
      }

      if (!dependencies.subscriptionsDetailService) {
        throw new HttpError(503, 'Subscriptions detail service is not available.');
      }

      const result = await dependencies.subscriptionsDetailService.getDetail({
        subscriptionId: request.params.subscriptionId,
        currentUser: request.currentUser,
        sessionToken: String(request.headers['x-session-token'] || '').trim()
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
