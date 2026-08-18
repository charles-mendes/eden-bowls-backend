const { HttpError } = require('../../core/http-error');
const { verifyJwtToken } = require('../../core/jwt-token');
const { AUTH_ERROR } = require('../contracts/auth-errors');

const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/token',
  '/api/v1/auth/account/email-exists',
  '/api/v1/auth/register',
  '/api/v1/auth/otp/verify',
  '/api/v1/auth/otp/resend'
]);

function isSessionAutocompleteRoute(request) {
  return /^\/api\/v1\/onboarding\/session\/[^/]+\/address\/autocomplete$/.test(request.path);
}

function isOnboardingSessionRoute(request) {
  return /^\/api\/v1\/onboarding\/session(?:\/|$)/.test(request.path);
}

function isPublicGeoRoute(request) {
  return request.method === 'GET' && request.path === '/api/v1/geo/context';
}

function isPublicAuthRoute(request, extraAuthPath) {
  if (request.method !== 'POST') {
    return false;
  }

  if (PUBLIC_AUTH_PATHS.has(request.path)) {
    return true;
  }

  return Boolean(extraAuthPath) && request.path === extraAuthPath;
}

function buildBearerTokenMiddleware(options = {}) {
  const authPath = options.authPath || '/api/v1/auth/token';
  const jwtOptions = options.jwt || {};

  return (request, response, next) => {
    if (!request.path.startsWith('/api/v1') || isPublicAuthRoute(request, authPath) || isPublicGeoRoute(request) || isSessionAutocompleteRoute(request) || isOnboardingSessionRoute(request)) {
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
  buildBearerTokenMiddleware,
  PUBLIC_AUTH_PATHS
};
