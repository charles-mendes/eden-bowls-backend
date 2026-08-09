const { HttpError } = require('../../core/http-error');
const { parseAuthTokenInput } = require('../validators/auth-token.validator');

function sendAuthError(response, status, code, message) {
  response.status(status).json({
    code,
    message,
    data: { status }
  });
}

function registerAuthRoutes(app, dependencies = {}) {
  app.post('/api/v1/auth/token', async (request, response, next) => {
    try {
      if (!dependencies.authService) {
        throw new HttpError(503, 'Auth service is not available.');
      }

      const payload = parseAuthTokenInput(request.body || {});
      const result = await dependencies.authService.authenticate(payload);
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        sendAuthError(response, error.statusCode, error.details.code, error.message);
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerAuthRoutes,
  sendAuthError
};
