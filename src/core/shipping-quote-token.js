const crypto = require('crypto');
const { HttpError } = require('./http-error');
const { assertInsideDeliveryArea } = require('./delivery-closed-days');
const { resolveMarket } = require('./market');

const SHIPPING_QUOTE_TTL_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

const QUOTE_EXPIRED = 'quote_expired';

function deliveryAreaUnverified(reason) {
  return new HttpError(422, 'delivery_area_unverified', {
    code: 'delivery_area_unverified',
    ...(reason ? { reason } : {})
  });
}

function quoteZipcode(country, zipcode) {
  const digits = String(zipcode || '').replace(/\D/g, '');
  return country === 'US' ? digits.slice(0, 5) : digits.slice(0, 8);
}

function quoteAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

class ShippingQuoteSigner {
  constructor(options = {}) {
    if (!options.secret) {
      throw new Error('A shipping quote secret is required.');
    }
    this.key = crypto.createHmac('sha256', String(options.secret)).update('eden-shipping-quote-v1').digest();
    this.ttlMs = options.ttlMs || SHIPPING_QUOTE_TTL_MS;
    this.now = options.now || (() => new Date());
  }

  mac(body) {
    return crypto.createHmac('sha256', this.key).update(body).digest();
  }

  sign({ country, zipcode, cost, distance = null, deliveryDays = null }) {
    const normalized = String(country || '').toUpperCase();
    const claims = {
      country: normalized,
      zipcode: quoteZipcode(normalized, zipcode),
      cost: quoteAmount(cost),
      distance: distance == null ? null : quoteAmount(distance),
      delivery_days: deliveryDays == null ? null : quoteAmount(deliveryDays),
      iat: this.now().getTime()
    };
    const body = base64url(JSON.stringify(claims));
    return `${body}.${base64url(this.mac(body))}`;
  }

  inspect(token) {
    const [body, signature, extra] = String(token || '').split('.');
    if (!body || !signature || extra !== undefined) {
      return { claims: null, expired: false };
    }
    const expected = this.mac(body);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return { claims: null, expired: false };
    }
    let claims;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (_error) {
      return { claims: null, expired: false };
    }
    const age = this.now().getTime() - Number(claims.iat);
    if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS) {
      return { claims: null, expired: false };
    }
    return { claims, expired: age > this.ttlMs };
  }

  read(token) {
    const { claims, expired } = this.inspect(token);
    return expired ? null : claims;
  }
}

function verifiedDeliveryQuote(signer, market, shipping = {}, { zipcode } = {}) {
  const normalized = String(market || '').toUpperCase();
  const { claims, expired } = signer ? signer.inspect(shipping.quote_token) : { claims: null, expired: false };
  if (!claims || claims.country !== normalized) {
    throw deliveryAreaUnverified();
  }
  if (!claims.zipcode || quoteZipcode(normalized, zipcode) !== claims.zipcode) {
    throw deliveryAreaUnverified();
  }
  if (quoteAmount(shipping.cost || shipping.total) !== claims.cost) {
    throw deliveryAreaUnverified();
  }
  if (normalized === 'BR' && quoteAmount(shipping.distance) !== quoteAmount(claims.distance)) {
    throw deliveryAreaUnverified();
  }
  if (normalized === 'US' && quoteAmount(shipping.delivery_days) !== quoteAmount(claims.delivery_days)) {
    throw deliveryAreaUnverified();
  }
  // Only a genuine, untouched quote may say it expired; anything else stays a bare refusal.
  if (expired) {
    throw deliveryAreaUnverified(QUOTE_EXPIRED);
  }
  return claims;
}

function assertVerifiedDeliveryArea(signer, market, shipping, context) {
  const claims = verifiedDeliveryQuote(signer, market, shipping, context);
  assertInsideDeliveryArea(market, { distance: claims.distance, delivery_days: claims.delivery_days });
  return claims;
}

function verifiedEditShipping(signer, row = {}, payload = {}) {
  if (!payload.shipping && !payload.address) {
    return row.shipping || {};
  }
  const address = payload.address || row.address || {};
  const market = resolveMarket({ country: address.country }).country;
  assertVerifiedDeliveryArea(signer, market, payload.shipping || {}, {
    zipcode: address.zipcode || address.postal_code
  });
  return payload.shipping;
}

module.exports = {
  QUOTE_EXPIRED,
  SHIPPING_QUOTE_TTL_MS,
  ShippingQuoteSigner,
  assertVerifiedDeliveryArea,
  verifiedDeliveryQuote,
  verifiedEditShipping
};
