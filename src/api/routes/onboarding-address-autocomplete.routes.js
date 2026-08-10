const { HttpError } = require('../../core/http-error');
const { parseAutocompleteAddressInput } = require('../validators/onboarding-address-autocomplete.validator');

function registerOnboardingAddressAutocompleteRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/session/:sessionId/address/autocomplete', async (request, response, next) => {
    try {
      const sessionToken = String(request.headers['x-session-token'] || '').trim();
      const authorization = String(request.headers.authorization || '').trim();
      const hasSessionToken = Boolean(sessionToken || authorization);

      if (!hasSessionToken) {
        response.status(401).json({
          success: false,
          message: 'Session access token is required.'
        });
        return;
      }

      if (!dependencies.onboardingAddressAutocompleteService) {
        throw new HttpError(503, 'Onboarding address autocomplete service is not available.');
      }

      const payload = parseAutocompleteAddressInput(request.body || {});
      const result = await dependencies.onboardingAddressAutocompleteService.autocomplete({
        sessionId: request.params.sessionId,
        payload
      });

      response.status(200).json(result);
    } catch (error) {
      if (error instanceof HttpError && error.details && error.details.code) {
        response.status(error.statusCode).json({
          success: false,
          message: error.message
        });
        return;
      }

      next(error);
    }
  });
}

module.exports = {
  registerOnboardingAddressAutocompleteRoutes
};
