const { HttpError } = require('../../core/http-error');

function sendAdminAuthError(response, error) {
  const statusCode = Number(error.statusCode || error.status || 500);
  response.status(statusCode).json({
    success: false,
    message: statusCode >= 500 ? 'Internal server error.' : error.message
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
  sendAdminAuthError
};
