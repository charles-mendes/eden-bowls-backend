const { HttpError } = require('./http-error');

// Field rules for a courier delivery (courier-delivery). Each parser returns undefined for an omitted field,
// null for an empty one, and throws 422 with the field name otherwise.
const COURIER_METHODS = ['uber', 'motoboy', 'own_driver', 'other'];
// address_unusable feeds the invalid-address notice of a later batch (PM-24).
const FAILURE_KINDS = ['address_unusable', 'customer_absent', 'other'];
const TRACKING_URL_MAX = 500;
const COURIER_NAME_MAX = 120;
const NOTE_MAX = 500;
const REASON_MAX = 500;
const COST_PATTERN = /^\d+(\.\d{1,2})?$/;

function invalid(field, message) {
  return new HttpError(422, message, { code: 'invalid_courier_field', field });
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function parseMethod(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const method = text(value);
  if (!COURIER_METHODS.includes(method)) {
    throw invalid('method', `Method must be one of ${COURIER_METHODS.join(', ')}.`);
  }
  return method;
}

// An absolute https URL with a host, no credentials, no spaces, up to 500 characters. Stored as trimmed.
function parseTrackingUrl(value) {
  if (value === undefined) return undefined;
  const raw = text(value);
  if (!raw) return null;
  const refuse = () => invalid('tracking_url', 'The tracking link must be an https URL of up to 500 characters.');
  if (raw.length > TRACKING_URL_MAX || /\s/.test(raw)) throw refuse();
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    throw refuse();
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw refuse();
  return raw;
}

// A decimal BRL string with at most two decimals, turned into centavos without floating point.
function parseCost(value) {
  if (value === undefined) return undefined;
  if (value === null || text(value) === '') return null;
  const raw = text(value);
  if (!COST_PATTERN.test(raw)) {
    throw invalid('cost', 'The cost must be zero or more, with at most two decimals.');
  }
  const [reais, cents = ''] = raw.split('.');
  const minor = Number(reais) * 100 + Number(cents.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > 4294967295) throw invalid('cost', 'The cost is too large.');
  return minor;
}

function parseLimitedText(field, max) {
  return (value) => {
    if (value === undefined) return undefined;
    const clean = text(value);
    if (!clean) return null;
    if ([...clean].length > max) throw invalid(field, `${field} must have at most ${max} characters.`);
    return clean;
  };
}

const parseCourierName = parseLimitedText('courier_name', COURIER_NAME_MAX);
const parseNote = parseLimitedText('note', NOTE_MAX);

function parseFailureReason(value) {
  const reason = parseLimitedText('reason', REASON_MAX)(value);
  if (!reason) throw invalid('reason', 'A failed delivery needs a reason.');
  return reason;
}

// Optional: undefined or empty means no kind, as for failures recorded before it existed.
function parseFailureKind(value) {
  if (value === undefined || value === null || text(value) === '') return null;
  const kind = text(value);
  if (!FAILURE_KINDS.includes(kind)) {
    throw invalid('failure_kind', `failure_kind must be one of ${FAILURE_KINDS.join(', ')}.`);
  }
  return kind;
}

// Every editable detail at once. `required` makes the method mandatory (dispatch).
function parseCourierDetails(body = {}, { required = false } = {}) {
  const details = {
    method: parseMethod(body.method, { required }),
    courierName: parseCourierName(body.courier_name),
    trackingUrl: parseTrackingUrl(body.tracking_url),
    costMinor: parseCost(body.cost),
    note: parseNote(body.note)
  };
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

module.exports = {
  COURIER_METHODS,
  FAILURE_KINDS,
  parseCost,
  parseCourierDetails,
  parseCourierName,
  parseFailureKind,
  parseFailureReason,
  parseMethod,
  parseNote,
  parseTrackingUrl
};
