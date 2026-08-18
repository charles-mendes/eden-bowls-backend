const { fetchJson } = require('../http/fetch-json');

class ZippopotamClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  async lookupUs(zipcode) {
    const digits = String(zipcode || '').replace(/\D/g, '');
    const zip5 = digits.slice(0, 5);
    if (zip5.length !== 5) {
      return { status: 'not_found' };
    }

    const response = await fetchJson(`https://api.zippopotam.us/us/${encodeURIComponent(zip5)}`, {
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      headers: { Accept: 'application/json' }
    });

    if (response.status === 404) {
      return { status: 'not_found' };
    }

    if (!response.ok || !response.body || typeof response.body !== 'object') {
      return { status: 'upstream' };
    }

    const place = Array.isArray(response.body.places) ? response.body.places[0] : null;
    const city = String(place && (place['place name'] || place.placeName) || '').trim();
    const state = String(place && (place['state abbreviation'] || place.stateAbbreviation) || '').trim();

    if (!city || !state) {
      return { status: 'not_found' };
    }

    return {
      status: 'ok',
      address: {
        city,
        state,
        street: '',
        neighborhood: '',
        complement: '',
        zipcode: zip5
      }
    };
  }
}

module.exports = {
  ZippopotamClient
};
