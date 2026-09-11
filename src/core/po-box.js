const PO_BOX_PATTERN = /\b(?:p\.?\s*o\.?\s*box|post\s*office\s*box|postal\s*box)\b/i;

function isPoBoxAddress(...parts) {
  const text = parts
    .filter((part) => part != null && String(part).trim() !== '')
    .map((part) => String(part))
    .join(' ');
  return PO_BOX_PATTERN.test(text);
}

function assertNotPoBoxAddress(address = {}, options = {}) {
  const line1 = address.line1 || address.address || address.street || address.address1 || '';
  const line2 = address.line2 || address.street2 || address.address2 || address.complement || '';
  if (isPoBoxAddress(line1, line2)) {
    const { HttpError } = require('./http-error');
    throw new HttpError(
      options.statusCode || 422,
      options.message || 'UPS cannot deliver to a P.O. Box. Please use a street address.',
      { code: options.code || 'po_box_not_allowed' }
    );
  }
}

module.exports = {
  PO_BOX_PATTERN,
  assertNotPoBoxAddress,
  isPoBoxAddress
};
