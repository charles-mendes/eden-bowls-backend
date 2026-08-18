const { fetchJson } = require('../http/fetch-json');

const GEOCODE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const AUTOCOMPLETE_TTL_MS = 60 * 1000;
const DEFAULT_USER_AGENT = 'EdenBowlShipping/1.0 (https://edenbowl.com; shipping@edenbowl.com)';

class NominatimClient {
  constructor(options = {}) {
    this.cache = options.cache || null;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs || 5000;
    this.userAgent = String(options.userAgent || DEFAULT_USER_AGENT).trim() || DEFAULT_USER_AGENT;
    this.baseUrl = options.baseUrl || 'https://nominatim.openstreetmap.org';
  }

  headers() {
    return {
      Accept: 'application/json',
      'User-Agent': this.userAgent
    };
  }

  async geocodeBr({ street, neighborhood, city, state, zipcode }) {
    const cep8 = String(zipcode || '').replace(/\D/g, '').slice(0, 8);
    const cacheKey = `geo:${cep8}`;
    if (this.cache && cep8) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const parts = [street, neighborhood, city, state, cep8, 'Brasil'].map((part) => String(part || '').trim()).filter(Boolean);
    const params = new URLSearchParams({
      q: parts.join(', '),
      countrycodes: 'br',
      format: 'jsonv2',
      limit: '1',
      addressdetails: '0'
    });
    const response = await fetchJson(`${this.baseUrl}/search?${params.toString()}`, {
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      headers: this.headers()
    });

    if (!response.ok || !Array.isArray(response.body) || response.body.length === 0) {
      return { status: 'not_found' };
    }

    const hit = response.body[0] || {};
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { status: 'not_found' };
    }

    const result = { status: 'ok', lat, lng };
    if (this.cache && cep8) {
      this.cache.set(cacheKey, result, GEOCODE_TTL_MS);
    }

    return result;
  }

  async autocompleteUs(query, context = {}) {
    const normalizedQuery = this.buildUsQuery(query, context);
    const cacheKey = `ac-us:${normalizedQuery.toLowerCase()}`;
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const params = new URLSearchParams({
      q: normalizedQuery,
      countrycodes: 'us',
      format: 'json',
      limit: '6',
      addressdetails: '1'
    });
    const response = await fetchJson(`${this.baseUrl}/search?${params.toString()}`, {
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      headers: this.headers()
    });

    if (!response.ok) {
      return { status: 'upstream' };
    }

    const suggestions = this.mapUsSuggestions(Array.isArray(response.body) ? response.body : []);
    const result = suggestions.length > 0
      ? { status: 'ok', suggestions }
      : { status: 'not_found', suggestions: [] };

    if (this.cache) {
      this.cache.set(cacheKey, result, AUTOCOMPLETE_TTL_MS);
    }

    return result;
  }

  buildUsQuery(query, context = {}) {
    return [query, context.city, context.state, context.zipcode]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  mapUsSuggestions(results) {
    const suggestions = [];
    const seen = new Set();

    for (const item of results) {
      const address = item && item.address ? item.address : {};
      const street = this.buildStreet(address);
      const city = String(address.city || address.town || address.village || address.hamlet || '').trim();
      const state = this.extractUsState(address);
      const zipcode = String(address.postcode || '').trim();

      if (!street || !city || !state || !zipcode) {
        continue;
      }

      const label = String(item.display_name || `${street}, ${city}, ${state} ${zipcode}`).trim();
      if (seen.has(label)) {
        continue;
      }

      seen.add(label);
      suggestions.push({
        id: String(item.place_id || `autocomplete-${suggestions.length + 1}`),
        label,
        street,
        city,
        state,
        zipcode,
        country: 'US',
        neighborhood: String(address.neighbourhood || address.suburb || '').trim(),
        complement: ''
      });
    }

    return suggestions;
  }

  buildStreet(address = {}) {
    const houseNumber = String(address.house_number || '').trim();
    const road = String(address.road || address.pedestrian || address.residential || '').trim();
    if (!road) {
      return '';
    }

    return [houseNumber, road].filter(Boolean).join(' ');
  }

  extractUsState(address = {}) {
    const iso = String(address['ISO3166-2-lvl4'] || address.state_code || '').trim().toUpperCase();
    if (/^US-[A-Z]{2}$/.test(iso)) {
      return iso.slice(3);
    }

    if (/^[A-Z]{2}$/.test(iso)) {
      return iso;
    }

    const state = String(address.state || '').trim();
    if (/^[A-Za-z]{2}$/.test(state)) {
      return state.toUpperCase();
    }

    return '';
  }
}

module.exports = {
  NominatimClient,
  DEFAULT_USER_AGENT,
  GEOCODE_TTL_MS
};
