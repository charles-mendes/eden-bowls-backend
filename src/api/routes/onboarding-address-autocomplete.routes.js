const { HttpError } = require('../../core/http-error');
const { parseAutocompleteAddressInput } = require('../validators/onboarding-address-autocomplete.validator');

function registerOnboardingAddressAutocompleteRoutes(app, dependencies = {}) {
  app.post('/api/v1/onboarding/address/autocomplete', async (request, response, next) => {
    try {
      if (!dependencies.onboardingAddressAutocompleteService) {
        throw new HttpError(503, 'Onboarding address autocomplete service is not available.');
      }

      const payload = parseAutocompleteAddressInput(request.body || {});
      const result = await dependencies.onboardingAddressAutocompleteService.autocomplete({
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
