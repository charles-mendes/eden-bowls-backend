const { HttpError } = require('../../core/http-error');

function requireLifeStageSettingsService(dependencies) {
  if (!dependencies.lifeStageSettingsService) {
    throw new HttpError(503, 'Life-stage settings service is not available.');
  }
  return dependencies.lifeStageSettingsService;
}

// Limits are per market, so every route names exactly one.
function singleMarket(request) {
  const scope = request.marketQuery || {};
  if (!scope.market || !scope.stripeAccount) {
    throw new HttpError(400, 'Choose one market.', { code: 'market_required' });
  }
  return scope;
}

// Life-stage limits and giant breeds (nutrition-parameters). Reading needs nutrition.simulate; saving and the
// preview need nutrition.settings.write.
function registerAdminLifeStageSettingsRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/life-stage', requirePermission('nutrition.simulate', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).overview(singleMarket(request).market));
  });

  app.put('/api/v1/admin/life-stage/limits', requirePermission('nutrition.settings.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).updateLimits(
      singleMarket(request).market,
      (request.body || {}).limits,
      request.adminIdentity
    ));
  });

  app.post('/api/v1/admin/life-stage/breeds', requirePermission('nutrition.settings.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).createBreed(
      singleMarket(request).market,
      request.body || {},
      request.adminIdentity
    ));
  });

  app.patch('/api/v1/admin/life-stage/breeds/:id', requirePermission('nutrition.settings.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new HttpError(400, 'Invalid breed id.');
      }
      return requireLifeStageSettingsService(dependencies).updateBreed(
        singleMarket(request).market,
        id,
        request.body || {},
        request.adminIdentity
      );
    });
  });

  app.post('/api/v1/admin/life-stage/preview', requirePermission('nutrition.settings.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const scope = singleMarket(request);
      return requireLifeStageSettingsService(dependencies).preview(scope.market, scope.stripeAccount, request.body || {});
    });
  });
}

module.exports = {
  registerAdminLifeStageSettingsRoutes
};
