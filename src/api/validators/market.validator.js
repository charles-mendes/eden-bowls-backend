const { HttpError } = require('../../core/http-error');
const { normalizeCountry, normalizeDomain, resolveMarket } = require('../../core/market');

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return undefined;
}

function parseRequestMarket(request = {}, body = {}) {
  const country = firstPresent(
    body.country,
    request.query && request.query.country,
    request.headers && request.headers['x-eden-country']
  );
  const domain = firstPresent(
    body.domain,
    request.query && request.query.domain,
    request.headers && request.headers['x-eden-domain']
  );

  if (country !== undefined && !normalizeCountry(country)) {
    throw new HttpError(400, 'Invalid country.', { code: 'invalid_country' });
  }

  if (domain !== undefined && !normalizeDomain(domain)) {
    throw new HttpError(400, 'Invalid domain.', { code: 'invalid_domain' });
  }

  return resolveMarket({ country, domain });
}

module.exports = {
  parseRequestMarket
};
