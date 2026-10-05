const { HttpError } = require('../../core/http-error');

function requireCalendarService(dependencies) {
  if (!dependencies.adminDeliveryCalendarService) {
    throw new HttpError(503, 'Delivery calendar service is not available.');
  }
  return dependencies.adminDeliveryCalendarService;
}

function registerAdminDeliveryCalendarRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/delivery-calendar', requirePermission('production.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).listYear({
      marketQuery: request.marketQuery,
      year: (request.query || {}).year
    }));
  });
}

module.exports = {
  registerAdminDeliveryCalendarRoutes
};
