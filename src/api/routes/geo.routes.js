function registerGeoRoutes(app, dependencies = {}) {
  app.get('/api/v1/geo/context', async (request, response, next) => {
    try {
      if (!dependencies.geoService) {
        response.status(503).json({
          success: false,
          message: 'Geo service is not available.'
        });
        return;
      }

      const payload = await dependencies.geoService.getContext(request);
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerGeoRoutes
};
