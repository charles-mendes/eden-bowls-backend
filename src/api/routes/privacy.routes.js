const { HttpError } = require('../../core/http-error');
const { detectRequestIp } = require('../../core/geo-detection');
const { paginatedEnvelope, parsePageQuery } = require('../validators/admin-pagination');
const {
  parseCookieInput,
  parseMarketingInput,
  parseCreateRequestInput,
  parseRequestId
} = require('../validators/privacy.validator');

function requireUserId(request) {
  if (!request.currentUser || !request.currentUser.id) {
    throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
  }
  return request.currentUser.id;
}

function requirePrivacyService(dependencies) {
  if (!dependencies.privacyService) {
    throw new HttpError(503, 'Privacy service is not available.');
  }
  return dependencies.privacyService;
}

function requestContext(request, dependencies) {
  return {
    ipHash: undefined,
    ip: detectRequestIp(request, { trustProxy: Boolean(dependencies.trustProxy) }),
    userAgent: request.headers && request.headers['user-agent']
  };
}

function withHash(privacyService, request, dependencies) {
  const ctx = requestContext(request, dependencies);
  const hashed = privacyService.contextFromRequest({
    ip: ctx.ip,
    userAgent: ctx.userAgent
  });
  return hashed;
}

function registerPrivacyRoutes(app, dependencies = {}) {
  app.get('/api/v1/privacy/identity-confirm', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const result = await privacyService.confirmIdentityToken(request.query && request.query.token);
      response.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/profile/marketing', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const data = await privacyService.getMarketing({ userId: requireUserId(request) });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  async function updateMarketing(request, response, next) {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const payload = parseMarketingInput(request.body || {});
      const context = withHash(privacyService, request, dependencies);
      const data = await privacyService.setMarketing({
        userId: requireUserId(request),
        marketingOptIn: payload.marketingOptIn,
        source: 'preferences',
        ...context
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  app.put('/api/v1/profile/marketing', updateMarketing);
  app.patch('/api/v1/profile/marketing', updateMarketing);

  app.get('/api/v1/privacy/consents', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const data = await privacyService.listConsents({ userId: requireUserId(request) });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/v1/privacy/cookies', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const payload = parseCookieInput(request.body || {});
      const context = withHash(privacyService, request, dependencies);
      const data = await privacyService.setCookies({
        userId: requireUserId(request),
        analytics: payload.analytics,
        ads: payload.ads,
        source: payload.source,
        ...context
      });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/privacy/requests', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const data = await privacyService.listOwnRequests({ userId: requireUserId(request) });
      response.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/privacy/requests', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const payload = parseCreateRequestInput(request.body || {});
      const context = withHash(privacyService, request, dependencies);
      const domain = request.headers['x-eden-domain'];
      const data = await privacyService.createCustomerRequest({
        userId: requireUserId(request),
        type: payload.type,
        market: payload.market || (domain === 'com.br' ? 'BR' : 'US'),
        locale: payload.locale,
        note: payload.note,
        ...context
      });
      response.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/privacy/requests/:id/export', async (request, response, next) => {
    try {
      const privacyService = requirePrivacyService(dependencies);
      const pack = await privacyService.downloadOwnPackage({
        userId: requireUserId(request),
        requestId: parseRequestId(request.params.id)
      });
      response.status(200).json({ success: true, data: pack });
    } catch (error) {
      next(error);
    }
  });
}

function registerAdminPrivacyRoutes(app, dependencies, { requirePermission, handle }) {
  app.get('/api/v1/admin/privacy/requests', requirePermission('privacy.requests.read', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const { parseAdminListQuery } = require('../validators/privacy.validator');
      const query = parseAdminListQuery(request.query || {});
      const pagination = parsePageQuery(query);
      const result = await privacyService.listAdminRequests(query, pagination, request.adminIdentity);
      return paginatedEnvelope({
        items: result.items,
        total: result.total,
        page: pagination.page,
        perPage: pagination.perPage
      });
    });
  });

  app.post('/api/v1/admin/privacy/requests', requirePermission('privacy.requests.write', { market: 'query' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const { parseAdminCreateRequestInput } = require('../validators/privacy.validator');
      const payload = parseAdminCreateRequestInput(request.body || {});
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.createAdminRequest({
        ...payload,
        actorId
      });
    });
  });

  app.get('/api/v1/admin/privacy/requests/:id', requirePermission('privacy.requests.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      return privacyService.getAdminRequest(parseRequestId(request.params.id), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/in-progress', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.setInProgress(parseRequestId(request.params.id), actorId, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/extend', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const { parseExtendInput } = require('../validators/privacy.validator');
      const payload = parseExtendInput(request.body || {});
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.extendOnce(parseRequestId(request.params.id), payload.reason, actorId, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/complete', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const { parseCompleteInput } = require('../validators/privacy.validator');
      const payload = parseCompleteInput(request.body || {});
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.completeRequest(parseRequestId(request.params.id), payload.note, actorId, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/reject', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const { parseCompleteInput } = require('../validators/privacy.validator');
      const payload = parseCompleteInput(request.body || {});
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.rejectRequest(parseRequestId(request.params.id), payload.note, actorId, request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/send-verification', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      return privacyService.sendIdentityVerification(parseRequestId(request.params.id), request.adminIdentity);
    });
  });

  app.post('/api/v1/admin/privacy/requests/:id/verify-identity', requirePermission('privacy.requests.write', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const actorId = request.adminIdentity && Number(request.adminIdentity.userId);
      return privacyService.markIdentityVerified(parseRequestId(request.params.id), actorId, request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/privacy/requests/:id/export', requirePermission('privacy.requests.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      return privacyService.downloadAdminPackage(parseRequestId(request.params.id), request.adminIdentity);
    });
  });

  app.get('/api/v1/admin/users/:userId/privacy', requirePermission('users.read', { market: 'record' }), async (request, response, next) => {
    await handle(response, next, async () => {
      const privacyService = requirePrivacyService(dependencies);
      const userId = Number(request.params.userId);
      if (!Number.isSafeInteger(userId) || userId < 1) {
        throw new HttpError(400, 'Invalid user id.');
      }
      return privacyService.getUserPrivacySnapshot(userId, request.adminIdentity);
    });
  });
}

module.exports = {
  registerPrivacyRoutes,
  registerAdminPrivacyRoutes
};
