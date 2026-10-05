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

  app.get('/api/v1/admin/delivery-calendar/history', requirePermission('production.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).history({
      marketQuery: request.marketQuery,
      year: (request.query || {}).year
    }));
  });

  app.post('/api/v1/admin/delivery-calendar/preview', requirePermission('production.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).preview({
      marketQuery: request.marketQuery,
      body: request.body || {}
    }));
  });

  // Every write goes through the calendar service, which reschedules and audits in one transaction.
  app.post('/api/v1/admin/delivery-calendar', requirePermission('production.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).write({
      marketQuery: request.marketQuery,
      body: { ...(request.body || {}), id: undefined },
      identity: request.adminIdentity
    }));
  });

  app.patch('/api/v1/admin/delivery-calendar/:id', requirePermission('production.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).write({
      marketQuery: request.marketQuery,
      body: { ...(request.body || {}), id: request.params.id },
      identity: request.adminIdentity
    }));
  });

  app.delete('/api/v1/admin/delivery-calendar/:id', requirePermission('production.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireCalendarService(dependencies).remove({
      marketQuery: request.marketQuery,
      id: request.params.id,
      identity: request.adminIdentity
    }));
  });
}

module.exports = {
  registerAdminDeliveryCalendarRoutes
};
