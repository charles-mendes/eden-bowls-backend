const { HttpError } = require('../../core/http-error');

class OnboardingAddressAutocompleteRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.sessionTableName = options.sessionTableName || 'wp_hsr_onboarding_sessions';
  }

  async autocomplete(sessionId, payload = {}) {
    this.ensureDataSourceReady();

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

    const session = await this.findSession(sessionId);

    if (!session) {
      throw new HttpError(404, 'Session not found.', { code: 'session_not_found' });
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

  ensureDataSourceReady() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  resolveCountry(payload = {}) {
    const inputCountry = String(payload.country || '').trim().toUpperCase();
    if (inputCountry === 'US' || inputCountry === 'BR') {
      return inputCountry;
    }

    return 'US';
  }

  async findSession(sessionId) {
    const sql = `SELECT session_id AS sessionId, country FROM \`${this.sessionTableName}\` WHERE session_id = ? LIMIT 1`;
    const rows = await this.dataSource.query(sql, [sessionId]);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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
