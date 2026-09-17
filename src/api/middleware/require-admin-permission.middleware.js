const { HttpError } = require('../../core/http-error');
const { AUTH_ERROR } = require('../contracts/auth-errors');

function isPasswordChangeAllowedPath(method, path) {
  const normalized = String(path || '').split('?')[0];
  if (String(method || '').toUpperCase() === 'GET' && normalized === '/api/v1/admin/me') {
    return true;
  }

  return String(method || '').toUpperCase() === 'POST' && normalized === '/api/v1/admin/me/password';
}

function sendAdminAuthError(response, error) {
  const statusCode = Number(error.statusCode || error.status || 500);
  const details = error.details && typeof error.details === 'object' ? error.details : undefined;
  response.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Internal server error.' : error.message,
    ...(details && details.code ? { details: { code: details.code } } : {})
  });
}

function buildRequireAdminPermission(dependencies = {}) {
  return (permission) => async (request, response, next) => {
    try {
      if (!dependencies.adminIdentityService) {
        throw new HttpError(503, 'Admin identity service is not available.');
      }

      if (!request.currentUser || !request.currentUser.id) {
        throw new HttpError(401, 'Authentication is required.');
      }

      const identity = await dependencies.adminIdentityService.requireOperational(request.currentUser.id);

      if (identity.mustChangePassword && !isPasswordChangeAllowedPath(request.method, request.path)) {
        throw new HttpError(
          AUTH_ERROR.PASSWORD_CHANGE_REQUIRED.status,
          AUTH_ERROR.PASSWORD_CHANGE_REQUIRED.message,
          { code: AUTH_ERROR.PASSWORD_CHANGE_REQUIRED.code }
        );
      }

      if (permission && !identity.permissions.includes(permission)) {
        throw new HttpError(403, 'Forbidden.');
      }

      request.adminIdentity = identity;
      next();
    } catch (error) {
      if (error instanceof HttpError) {
        sendAdminAuthError(response, error);
        return;
      }

      next(error);
    }
  };
}

module.exports = {
  buildRequireAdminPermission,
  sendAdminAuthError,
  isPasswordChangeAllowedPath
};
