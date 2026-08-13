const { HttpError } = require('../../core/http-error');
const { parseAuthTokenInput } = require('../validators/auth-token.validator');

function sendAuthError(response, status, code, message) {
  response.status(status).json({
    code,
    message,
    data: { status }
  });
}

function setRefreshCookie(response, refreshToken, options = {}) {
  if (!refreshToken) {
    return;
  }

  const parts = [
    `${options.name || 'eden_refresh_token'}=${encodeURIComponent(refreshToken)}`,
    `Path=${options.path || '/api/v1/auth'}`,
    'HttpOnly',
    `SameSite=${String(options.sameSite || 'lax').replace(/^./, (value) => value.toUpperCase())}`,
    `Max-Age=${Number(options.maxAgeSeconds || 0)}`
  ];

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  response.setHeader('Set-Cookie', parts.join('; '));
}

function clearRefreshCookie(response, options = {}) {
  const parts = [
    `${options.name || 'eden_refresh_token'}=`,
    `Path=${options.path || '/api/v1/auth'}`,
    'HttpOnly',
    'Max-Age=0'
  ];

  if (options.domain) {
    parts.push(`Domain=${options.domain}`);
  }

  if (options.secure) {
    parts.push('Secure');
  }

  response.setHeader('Set-Cookie', parts.join('; '));
}

function readCookie(request, cookieName) {
  const cookieHeader = String(request.headers.cookie || '');
  const target = `${cookieName}=`;
  const item = cookieHeader.split(';').map((value) => value.trim()).find((value) => value.startsWith(target));

  if (!item) {
    return '';
  }

  try {
    return decodeURIComponent(item.slice(target.length));
  } catch {
    return '';
  }
}

function requireCookieRequestOrigin(request, origins = []) {
  const origin = String(request.headers.origin || '').trim();
  const requestedWith = String(request.headers['x-requested-with'] || '').trim();

  if (!origin || !origins.includes(origin) || requestedWith !== 'XMLHttpRequest') {
    throw new HttpError(403, 'Invalid authentication request origin.', { code: 'csrf_request_rejected' });
  }
}

function registerAuthRoutes(app, dependencies = {}) {
  app.post('/api/v1/auth/token', async (request, response, next) => {
    try {
      if (!dependencies.authService) {
        throw new HttpError(503, 'Auth service is not available.');
      }

      const payload = parseAuthTokenInput(request.body || {});
      const result = await dependencies.authService.authenticate(payload);
      setRefreshCookie(response, result.refreshToken, dependencies.authCookie);
      const { refreshToken, ...responseBody } = result;
      response.status(200).json(responseBody);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        sendAuthError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  });

  app.get('/api/v1/auth/me', async (request, response, next) => {
    try {
      if (!dependencies.authService) {
        throw new HttpError(503, 'Auth service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
      }

      const result = await dependencies.authService.getCurrentUser(request.currentUser.id);
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        sendAuthError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  });

  app.post('/api/v1/auth/refresh', async (request, response, next) => {
    try {
      if (!dependencies.authService) {
        throw new HttpError(503, 'Auth service is not available.');
      }

      requireCookieRequestOrigin(request, dependencies.corsOrigins || []);
      const refreshToken = readCookie(request, dependencies.authCookie && dependencies.authCookie.name || 'eden_refresh_token');
      const result = await dependencies.authService.refresh(refreshToken);
      setRefreshCookie(response, result.refreshToken, dependencies.authCookie);
      const { refreshToken: ignoredRefreshToken, ...responseBody } = result;
      response.status(200).json(responseBody);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        clearRefreshCookie(response, dependencies.authCookie);
        sendAuthError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  });

  app.post('/api/v1/auth/logout', async (request, response, next) => {
    try {
      if (!dependencies.authService) {
        throw new HttpError(503, 'Auth service is not available.');
      }

      requireCookieRequestOrigin(request, dependencies.corsOrigins || []);
      const refreshToken = readCookie(request, dependencies.authCookie && dependencies.authCookie.name || 'eden_refresh_token');
      await dependencies.authService.logout(refreshToken);
      clearRefreshCookie(response, dependencies.authCookie);
      response.status(204).end();
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        clearRefreshCookie(response, dependencies.authCookie);
        sendAuthError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerAuthRoutes,
  sendAuthError,
  setRefreshCookie,
  clearRefreshCookie,
  readCookie,
  requireCookieRequestOrigin
};
