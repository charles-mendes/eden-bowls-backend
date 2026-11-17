function registerBlingRoutes(app, dependencies = {}) {
  // Public by design: Bling redirects the operator's browser here. Nothing happens unless `state` matches.
  app.get('/api/v1/bling/oauth/callback', async (request, response, next) => {
    try {
      if (!dependencies.blingNfeService) {
        response.status(503).json({ success: false, message: 'NF-e service is not available.' });
        return;
      }
      const query = request.query || {};
      const code = typeof query.code === 'string' ? query.code : '';
      const state = typeof query.state === 'string' ? query.state : '';
      response.redirect(302, await dependencies.blingNfeService.handleOAuthCallback({ code, state }));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerBlingRoutes
};
