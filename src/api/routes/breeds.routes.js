const { HttpError } = require('../../core/http-error');
const { parseBreedsQuery } = require('../validators/breeds-query.validator');

function registerBreedsRoutes(app, dependencies = {}) {
  const handler = async (request, response, next) => {
    try {
      if (!dependencies.breedsService) {
        throw new HttpError(503, 'Breeds service is not available.');
      }

      const query = parseBreedsQuery(request.query);
      const payload = await dependencies.breedsService.listBreeds(query);
      response.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  };

  app.get('/api/v1/breeds', handler);
  app.get('/wp-json/custom/v1/breeds', handler);
}

module.exports = {
  registerBreedsRoutes
};