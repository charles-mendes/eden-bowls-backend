const { HttpError } = require('../../core/http-error');
const { verifyJwtToken } = require('../../core/jwt-token');
const { AUTH_ERROR } = require('../contracts/auth-errors');

function isSessionAutocompleteRoute(request) {
  return /^\/api\/v1\/onboarding\/session\/[^/]+\/address\/autocomplete$/.test(request.path);
}

function isOnboardingSessionRoute(request) {
  return /^\/api\/v1\/onboarding\/session(?:\/|$)/.test(request.path);
}

function isSubscriptionActionsRoute(request) {
  return /^\/api\/v1\/subscriptions\/[^/]+\/actions$/.test(request.path);
}

function isSubscriptionDetailRoute(request) {
  return /^\/api\/v1\/subscriptions\/[^/]+\/detail$/.test(request.path);
}

function isSubscriptionEditPreviewRoute(request) {
  return /^\/api\/v1\/subscriptions\/[^/]+\/edit\/preview$/.test(request.path);
}

function isSubscriptionsListRoute(request) {
  return request.path === '/api/v1/subscriptions';
}

function buildBearerTokenMiddleware(options = {}) {
  const authPath = options.authPath || '/api/v1/auth/token';
  const jwtOptions = options.jwt || {};

  return (request, response, next) => {
    if (!request.path.startsWith('/api/v1') || request.path === authPath || isSessionAutocompleteRoute(request) || isOnboardingSessionRoute(request) || isSubscriptionActionsRoute(request) || isSubscriptionDetailRoute(request) || isSubscriptionEditPreviewRoute(request) || isSubscriptionsListRoute(request)) {
      next();
      return;
    }

    const authorization = String(request.headers.authorization || '').trim();

    if (!authorization) {
      next();
      return;
    }

    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      next(new HttpError(AUTH_ERROR.BAD_AUTH_HEADER.status, AUTH_ERROR.BAD_AUTH_HEADER.message, {
        code: AUTH_ERROR.BAD_AUTH_HEADER.code
      }));
      return;
    }

    try {
      const verified = verifyJwtToken(match[1], jwtOptions);
      request.auth = verified;
      request.currentUser = verified && verified.data && verified.data.user ? verified.data.user : null;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  buildBearerTokenMiddleware
};
