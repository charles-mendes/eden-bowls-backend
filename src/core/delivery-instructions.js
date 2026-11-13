const { HttpError } = require('./http-error');

// Gate, where to leave the box, care with the pet (delivery-instructions). One line, so it fits a queue cell.
const DELIVERY_INSTRUCTIONS_KEY = 'delivery_instructions';
const DELIVERY_INSTRUCTIONS_MAX_LENGTH = 200;
const CONTROL = /\p{Cc}/u;

// Trimmed and collapsed to one line; '' when nothing is left.
function normalizeDeliveryInstructions(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function invalidDeliveryInstructions() {
  return new HttpError(422, `Delivery instructions must have at most ${DELIVERY_INSTRUCTIONS_MAX_LENGTH} characters, with no control characters.`, {
    code: 'invalid_delivery_instructions',
    field: DELIVERY_INSTRUCTIONS_KEY
  });
}

// The normalized text, or null when it breaks the rule. Length counts code points, not UTF-16 units.
function validateDeliveryInstructions(value) {
  if (value !== null && value !== undefined && typeof value !== 'string') return null;
  const text = normalizeDeliveryInstructions(value);
  if ([...text].length > DELIVERY_INSTRUCTIONS_MAX_LENGTH || CONTROL.test(text)) return null;
  return text;
}

// Writer input: undefined stays undefined (the caller keeps the stored value); '' clears; null clears too.
function parseDeliveryInstructionsInput(value) {
  if (value === undefined) return undefined;
  const text = validateDeliveryInstructions(value);
  if (text === null) throw invalidDeliveryInstructions();
  return text;
}

function storedInstructions(address) {
  if (!address || typeof address !== 'object') return '';
  return normalizeDeliveryInstructions(address[DELIVERY_INSTRUCTIONS_KEY] || address.deliveryInstructions || '');
}

function placeText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function placeOf(address = {}) {
  const country = String(address.country || '').trim().toUpperCase();
  const zipDigits = String(address.postal_code || address.zipcode || address.zipCode || address.postal || '').replace(/\D/g, '');
  return {
    country,
    zip: country === 'US' ? zipDigits.slice(0, 5) : zipDigits,
    street: placeText(address.street || address.address_line1 || address.line1 || address.address || address.address1),
    number: placeText(address.number)
  };
}

// The same place by the rule of delivery-instructions: country and ZIP, then BR street and number, or the US street line.
function sameDeliveryPlace(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = placeOf(a);
  const right = placeOf(b);
  if (!left.country || left.country !== right.country) return false;
  if (!left.zip || left.zip !== right.zip || !left.street || left.street !== right.street) return false;
  if (left.country === 'US') return true;
  return left.number === right.number;
}

// What a delivery shows: the subscription's own text, else the profile's when it is the same place.
function resolveDeliveryInstructions(subscriptionAddress, profileAddress) {
  const own = storedInstructions(subscriptionAddress);
  if (own) return { text: own, source: 'subscription' };
  const profile = storedInstructions(profileAddress);
  if (profile && sameDeliveryPlace(subscriptionAddress, profileAddress)) return { text: profile, source: 'profile' };
  return { text: null, source: null };
}

module.exports = {
  DELIVERY_INSTRUCTIONS_KEY,
  DELIVERY_INSTRUCTIONS_MAX_LENGTH,
  invalidDeliveryInstructions,
  normalizeDeliveryInstructions,
  parseDeliveryInstructionsInput,
  resolveDeliveryInstructions,
  sameDeliveryPlace,
  validateDeliveryInstructions
};
