const { HttpError } = require('../../core/http-error');

function requireParametersService(dependencies) {
  if (!dependencies.nutritionParametersService) {
    throw new HttpError(503, 'Nutrition parameters service is not available.');
  }
  return dependencies.nutritionParametersService;
}

// Nutrition parameter sets (nutrition-parameters). They apply to both markets, so the routes have no market
// scope. Reading needs nutrition.simulate; changing the draft and publishing need nutrition.settings.write.
function registerAdminNutritionSettingsRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/nutrition/parameters', requirePermission('nutrition.simulate', { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => requireParametersService(dependencies).overview());
  });

  app.put('/api/v1/admin/nutrition/parameters/draft', requirePermission('nutrition.settings.write', { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => requireParametersService(dependencies).saveDraft(
      (request.body || {}).parameters,
      request.adminIdentity
    ));
  });

  app.delete('/api/v1/admin/nutrition/parameters/draft', requirePermission('nutrition.settings.write', { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => requireParametersService(dependencies).discardDraft());
  });

  app.post('/api/v1/admin/nutrition/parameters/:id/copy-to-draft', requirePermission('nutrition.settings.write', { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new HttpError(400, 'Invalid parameter set id.');
      }
      return requireParametersService(dependencies).copyToDraft(id, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/nutrition/parameters/publish', requirePermission('nutrition.settings.write', { market: 'none' }), async (request, response, next) => {
    await handle(response, next, async () => requireParametersService(dependencies).publish(request.adminIdentity));
  });
}

module.exports = {
  registerAdminNutritionSettingsRoutes
};
