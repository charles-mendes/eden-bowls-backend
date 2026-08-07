const rateLimit = require('express-rate-limit');
const { HttpError } = require('../../core/http-error');
const { PRODUCTS_ERROR } = require('../contracts/products-errors');
const { parseProductsQuery } = require('../validators/products-query.validator');

function productsRateLimitKeyGenerator(request) {
  const userAgent = String(request.headers['user-agent'] || '').trim();
  return `${rateLimit.ipKeyGenerator(request.ip)}|${userAgent}`;
}

function sendWpError(response, status, code, message) {
  response.status(status).json({
    code,
    message,
    data: { status }
  });
}

function registerProductsRoutes(app, dependencies = {}) {
  const limiter = rateLimit({
    windowMs: 300 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: productsRateLimitKeyGenerator,
    handler: (request, response) => {
      sendWpError(
        response,
        PRODUCTS_ERROR.TOO_MANY_REQUESTS.status,
        PRODUCTS_ERROR.TOO_MANY_REQUESTS.code,
        PRODUCTS_ERROR.TOO_MANY_REQUESTS.message
      );
    }
  });

  const handler = async (request, response, next) => {
    try {
      if (!dependencies.productsService) {
        throw new HttpError(503, 'Products service is not available.');
      }

      const query = parseProductsQuery(request.query);
      const payload = await dependencies.productsService.listProducts(query);
      response.status(200).json(payload);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        sendWpError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  };

  app.get('/api/v1/products', limiter, handler);
}

module.exports = {
  registerProductsRoutes,
  productsRateLimitKeyGenerator,
  sendWpError
};
