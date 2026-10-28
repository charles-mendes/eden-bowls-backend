const rateLimit = require('express-rate-limit');
const { HttpError } = require('../../core/http-error');
const { legalKind, legalMarket } = require('../../core/legal-documents');
const { productsRateLimitKeyGenerator } = require('./products.routes');

function requireLegalDocumentsService(dependencies) {
  if (!dependencies.legalDocumentsService) {
    throw new HttpError(503, 'Legal documents service is not available.');
  }
  return dependencies.legalDocumentsService;
}

function kindOf(request) {
  const kind = legalKind(request.params.kind);
  if (!kind) {
    throw new HttpError(404, 'Legal document not found.', { code: 'legal_document_not_found' });
  }
  return kind;
}

// The current privacy policy or terms of use of a market, for the store (legal-documents). No sign-in.
function registerLegalRoutes(app, dependencies = {}) {
  const limiter = rateLimit({
    windowMs: 300 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: productsRateLimitKeyGenerator
  });

  app.get('/api/v1/legal/:kind', limiter, async (request, response, next) => {
    try {
      const kind = kindOf(request);
      const market = legalMarket(request.query.market);
      response.status(200).json(await requireLegalDocumentsService(dependencies).current(market, kind));
    } catch (error) {
      next(error);
    }
  });
}

// Versions of the legal documents in the admin. Reading needs settings.read; publishing needs legal.write.
function registerAdminLegalRoutes(app, dependencies, { requirePermission, handle }) {
  const marketOf = (request) => {
    const market = (request.marketQuery || {}).market;
    if (!market) {
      throw new HttpError(400, 'Choose one market.', { code: 'market_required' });
    }
    return market;
  };

  app.get('/api/v1/admin/legal/:kind', requirePermission('settings.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLegalDocumentsService(dependencies).overview(marketOf(request), kindOf(request)));
  });

  app.get('/api/v1/admin/legal/:kind/versions/:version', requirePermission('settings.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLegalDocumentsService(dependencies).version(
      marketOf(request),
      kindOf(request),
      String(request.params.version || '')
    ));
  });

  app.post('/api/v1/admin/legal/:kind', requirePermission('legal.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => requireLegalDocumentsService(dependencies).publish(
      marketOf(request),
      kindOf(request),
      request.body || {},
      request.adminIdentity
    ));
  });
}

module.exports = {
  registerAdminLegalRoutes,
  registerLegalRoutes
};
