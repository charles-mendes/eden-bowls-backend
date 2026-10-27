const rateLimit = require('express-rate-limit');
const { HttpError } = require('../../core/http-error');
const { productsRateLimitKeyGenerator } = require('./products.routes');

// Public recipe content for the store (recipe-content), with the same limit as /api/v1/products.
function registerRecipesRoutes(app, dependencies = {}) {
  const limiter = rateLimit({
    windowMs: 300 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: productsRateLimitKeyGenerator
  });

  app.get('/api/v1/recipes', limiter, async (request, response, next) => {
    try {
      if (!dependencies.recipeContentService) {
        throw new HttpError(503, 'Recipe content service is not available.');
      }
      const payload = await dependencies.recipeContentService.listPublic(request.query.market);
      response.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/recipes/:key', limiter, async (request, response, next) => {
    try {
      if (!dependencies.recipeContentService) {
        throw new HttpError(503, 'Recipe content service is not available.');
      }
      const payload = await dependencies.recipeContentService.getPublic(request.params.key, request.query.market);
      response.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerRecipesRoutes
};
