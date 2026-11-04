const { HttpError } = require('../../core/http-error');

// Shape checks only; the field rules live in core/courier-fields.js so dispatch and edit share them.
const TEXT_FIELDS = ['invoice_id', 'method', 'courier_name', 'tracking_url', 'note', 'reason', 'delivered_at'];

function parseCourierDeliveryId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new HttpError(404, 'Courier delivery not found.');
  }
  return id;
}

function parseCourierBody(body) {
  if (body == null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be an object.', { code: 'invalid_body' });
  }
  const parsed = {};
  for (const key of TEXT_FIELDS) {
    if (body[key] === undefined) continue;
    if (body[key] !== null && typeof body[key] !== 'string') {
      throw new HttpError(422, `${key} must be text.`, { code: 'invalid_courier_field', field: key });
    }
    parsed[key] = body[key];
  }
  if (body.cost !== undefined) {
    if (body.cost !== null && typeof body.cost !== 'string' && typeof body.cost !== 'number') {
      throw new HttpError(422, 'cost must be a decimal.', { code: 'invalid_courier_field', field: 'cost' });
    }
    parsed.cost = body.cost;
  }
  if (body.confirm_not_ready === true) parsed.confirm_not_ready = true;
  return parsed;
}

module.exports = { parseCourierBody, parseCourierDeliveryId };
