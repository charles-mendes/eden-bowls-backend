class OnboardingAddressAutocompleteRepository {
  async autocomplete(payload = {}) {
    const resolvedCountry = this.resolveCountry(payload);

    if (resolvedCountry !== 'US') {
      return {
        status: 'unsupported_country',
        country: resolvedCountry || 'BR',
        query: String(payload.query || ''),
        suggestions: [],
        message: 'Autocomplete is currently supported only for US addresses.'
      };
    }

    const query = String(payload.query || '').trim();

    if (query.length < 4) {
      return {
        status: 'incomplete',
        country: 'US',
        query,
        suggestions: [],
        message: 'Query must be at least 4 characters long.'
      };
    }

    const normalizedQuery = this.normalizeQuery(query, payload);
    const suggestions = this.buildSuggestions(normalizedQuery);

    if (suggestions.length === 0) {
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

  normalizeQuery(query, payload = {}) {
    const parts = [query];

    if (payload.city) {
      parts.push(payload.city);
    }

    if (payload.state) {
      parts.push(payload.state);
    }

    if (payload.zipcode) {
      parts.push(payload.zipcode);
    }

    return parts.filter(Boolean).join(' ');
  }

  buildSuggestions(query) {
    const result = [];
    const seen = new Set();
    const baseLabel = String(query || '').trim();

    if (!baseLabel) {
      return result;
    }

    const sample = {
      id: 'autocomplete-1',
      label: `${baseLabel} Street`,
      street: `${baseLabel} Street`,
      city: 'Springfield',
      state: 'IL',
      zipcode: '62704',
      country: 'US',
      neighborhood: '',
      complement: ''
    };

    if (!seen.has(sample.label)) {
      seen.add(sample.label);
      result.push(sample);
    }

    return result;
  }
}

module.exports = {
  OnboardingAddressAutocompleteRepository
};
