const crypto = require('crypto');

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }

  return value;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function buildCurrentHash({ items = [], termMonths, address = {}, shipping = {} } = {}) {
  return hashPayload({
    items: Array.isArray(items) ? items : [],
    termMonths: Number(termMonths || 0),
    address: address && typeof address === 'object' ? address : {},
    shipping: shipping && typeof shipping === 'object' ? shipping : {}
  });
}

module.exports = {
  canonicalize,
  hashPayload,
  buildCurrentHash
};
