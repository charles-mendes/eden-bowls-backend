const { HttpError } = require('../../core/http-error');

function registerShippingRoutes(app, dependencies = {}) {
  app.post('/shipping/v1/calculate', async (request, response, next) => {
    try {
      if (!dependencies.shippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }

      const result = await dependencies.shippingService.calculate(request.body || {});
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

  app.get('/shipping/v1/settings', async (request, response, next) => {
    try {
      if (!dependencies.shippingService) {
        throw new HttpError(503, 'Shipping service is not available.');
      }

      const result = dependencies.shippingService.getPublicSettings(request.query && request.query.country);
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerShippingRoutes
};
