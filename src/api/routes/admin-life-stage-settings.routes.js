const { HttpError } = require('../../core/http-error');
const { marketsFromIdentity } = require('../../core/admin-market-scope');

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

function hasPermission(identity, permission) {
  return Boolean(identity && Array.isArray(identity.permissions) && identity.permissions.includes(permission));
}

function canWriteSettings(identity) {
  return hasPermission(identity, 'nutrition.settings.write');
}

// Breeds are written by the veterinarian or the admin in any market, or by an operator only in a market assigned to
// them. Limits are written only by the veterinarian (nutrition.limits.write), in any market. An operator with no assigned market writes nothing: the "both markets" fallback is for reading.
function writableMarket(request) {
  const scope = singleMarket(request);
  const identity = request.adminIdentity;
  if (!canWriteSettings(identity) && !marketsFromIdentity(identity).includes(scope.market)) {
    throw new HttpError(403, 'Requested market is outside staff scope.', { code: 'market_forbidden' });
  }
  return scope;
}

// Life-stage limits and giant breeds (nutrition-parameters). Reading needs nutrition.simulate; saving limits needs
// nutrition.limits.write; creating and editing breeds needs nutrition.breeds.write; the preview needs the permission
// of what it previews.
function registerAdminLifeStageSettingsRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/life-stage', requirePermission('nutrition.simulate', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).overview(singleMarket(request).market));
  });

  app.put('/api/v1/admin/life-stage/limits', requirePermission('nutrition.limits.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).updateLimits(
      writableMarket(request).market,
      (request.body || {}).limits,
      request.adminIdentity
    ));
  });

  app.post('/api/v1/admin/life-stage/breeds', requirePermission('nutrition.breeds.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLifeStageSettingsService(dependencies).createBreed(
      writableMarket(request).market,
      request.body || {},
      request.adminIdentity
    ));
  });

  app.patch('/api/v1/admin/life-stage/breeds/:id', requirePermission('nutrition.breeds.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const scope = writableMarket(request);
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new HttpError(400, 'Invalid breed id.');
      }
      return requireLifeStageSettingsService(dependencies).updateBreed(
        scope.market,
        id,
        request.body || {},
        request.adminIdentity
      );
    });
  });

  // Gated by nutrition.simulate so either writer gets in; the body then needs the permission of each part it previews.
  app.post('/api/v1/admin/life-stage/preview', requirePermission('nutrition.simulate', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const body = request.body || {};
      const identity = request.adminIdentity;
      const needed = [];
      if (body.limits !== undefined) needed.push('nutrition.limits.write');
      if (body.breed !== undefined) needed.push('nutrition.breeds.write');
      const allowed = needed.length
        ? needed.every((permission) => hasPermission(identity, permission))
        : hasPermission(identity, 'nutrition.limits.write') || hasPermission(identity, 'nutrition.breeds.write');
      if (!allowed) {
        throw new HttpError(403, 'Forbidden.');
      }
      const scope = writableMarket(request);
      return requireLifeStageSettingsService(dependencies).preview(scope.market, scope.stripeAccount, request.body || {});
    });
  });
}

module.exports = {
  registerAdminLifeStageSettingsRoutes
};
