class OnboardingAddressAutocompleteRepository {
  constructor(options = {}) {
    this.nominatimClient = options.nominatimClient || null;
  }

  async autocomplete(payload = {}) {
    const resolvedCountry = this.resolveCountry(payload);
    const query = String(payload.query || '').trim();

    if (resolvedCountry !== 'US') {
      return {
        status: 'unsupported_country',
        country: resolvedCountry || 'BR',
        query,
        suggestions: [],
        message: 'Autocomplete is currently supported only for US addresses.'
      };
    }

    if (query.length < 4) {
      return {
        status: 'incomplete',
        country: 'US',
        query,
        suggestions: [],
        message: 'Query must be at least 4 characters long.'
      };
    }

    if (!this.nominatimClient) {
      return {
        status: 'error',
        country: 'US',
        query,
        suggestions: [],
        message: 'Address autocomplete is temporarily unavailable.'
      };
    }

    const result = await this.nominatimClient.autocompleteUs(query, {
      city: payload.city,
      state: payload.state,
      zipcode: payload.zipcode
    });

    if (result.status === 'upstream') {
      return {
        status: 'error',
        country: 'US',
        query,
        suggestions: [],
        message: 'Address autocomplete is temporarily unavailable.'
      };
    }

    const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
    if (result.status !== 'ok' || suggestions.length === 0) {
      return {
        status: 'not_found',
        country: 'US',
        query,
        suggestions: [],
        message: 'No suggestions were found.'
      };
    }

    return {
      status: 'found',
      country: 'US',
      query,
      suggestions,
      message: `Found ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}.`
    };
  }

  resolveCountry(payload = {}) {
    const inputCountry = String(payload.country || '').trim().toUpperCase();
    if (inputCountry === 'US' || inputCountry === 'BR') {
      return inputCountry;
    }

    return 'US';
  }
}

module.exports = {
  OnboardingAddressAutocompleteRepository
};
