const { HttpError } = require('../core/http-error');

class OnboardingAddressAutocompleteService {
  constructor(repository) {
    this.repository = repository;
  }

  async autocomplete({ payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding address autocomplete repository is not available.');
    }

    const result = await this.repository.autocomplete(payload);

    return {
      success: true,
      data: result
    };
  }
}

module.exports = {
  OnboardingAddressAutocompleteService
};
