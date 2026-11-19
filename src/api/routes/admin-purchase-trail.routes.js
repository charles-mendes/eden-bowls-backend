const { HttpError } = require('../../core/http-error');
const { normalizeTrailMarket } = require('../../core/purchase-trail');

const MAX_LIMIT = 50;

function requireTrailService(dependencies) {
  if (!dependencies.customerPurchaseTrailService) {
    throw new HttpError(503, 'Purchase trail is not available.');
  }
  return dependencies.customerPurchaseTrailService;
}

// The trail never mixes markets: one market is named, br or us. constrainMarketQuery (run by requirePermission)
// already answered 403 market_forbidden for a market outside the staff scope; without a market it would list all of
// them, so a missing or unknown one is refused here.
function requiredMarket(request) {
  const raw = (request.query || {}).market;
  const market = normalizeTrailMarket(raw);
  if (!market || String(raw).trim().toLowerCase() !== market) {
    throw new HttpError(400, 'Choose one market: br or us.', { code: 'market_required' });
  }
  return market;
}

function pageOf(request, fallback) {
  const query = request.query || {};
  const limit = Number(query.limit);
  const before = Number(query.before);
  return {
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : fallback,
    before: Number.isSafeInteger(before) && before > 0 ? before : null
  };
}

// customer-purchase-trail: read only, operational roles with billing.subscribers.read (readonly has it, a
// veterinarian does not). A customer token never reaches the handler: requirePermission refuses it.
function registerAdminPurchaseTrailRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/users/:userId/purchase-trail', requirePermission('billing.subscribers.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const market = requiredMarket(request);
      const userId = Number(request.params.userId);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new HttpError(400, 'Invalid user id.', { code: 'invalid_user_id' });
      }
      const page = pageOf(request, 20);
      const data = await requireTrailService(dependencies).listForCustomer({ userId, market, ...page });
      return { success: true, data: { user_id: userId, market, ...data } };
    });
  });

  app.get('/api/v1/admin/purchase-trail/config-events', requirePermission('billing.subscribers.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const market = requiredMarket(request);
      const page = pageOf(request, MAX_LIMIT);
      const data = await requireTrailService(dependencies).listConfigEvents({ market, ...page });
      return { success: true, data: { market, ...data } };
    });
  });
}

module.exports = {
  registerAdminPurchaseTrailRoutes
};
