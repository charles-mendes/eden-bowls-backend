const { HttpError } = require('./http-error');

// The person who receives the box (delivery-recipient). Its own address key, never `name`: email greetings read
// `address.name`, and the recipient must not change them. Not the fiscal name rule, which wants two words.
const RECIPIENT_NAME_KEY = 'recipient_name';
const RECIPIENT_NAME_MIN_LENGTH = 2;
const RECIPIENT_NAME_MAX_LENGTH = 60;
const LETTER = /\p{L}/u;

// Trimmed, with single spaces, or null when nothing is left.
function normalizeRecipientName(value) {
  const name = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  return name || null;
}

// The normalized name, or null when it breaks the rule. Length counts characters, not UTF-16 units.
function validateRecipientName(value) {
  const name = normalizeRecipientName(value);
  if (!name) return null;
  const length = [...name].length;
  if (length < RECIPIENT_NAME_MIN_LENGTH || length > RECIPIENT_NAME_MAX_LENGTH) return null;
  if (!LETTER.test(name) || name.includes('@')) return null;
  return name;
}

function invalidRecipientName() {
  return new HttpError(422, 'Recipient name must have 2 to 60 characters, with at least one letter and no @.', {
    code: 'invalid_recipient_name',
    field: RECIPIENT_NAME_KEY
  });
}

// Writer input: undefined stays undefined (the caller keeps the stored value) unless the field is required.
// Anything sent, an empty string included, must pass the rule.
function parseRecipientNameInput(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const name = validateRecipientName(value);
  if (!name) throw invalidRecipientName();
  return name;
}

module.exports = {
  RECIPIENT_NAME_KEY,
  RECIPIENT_NAME_MAX_LENGTH,
  normalizeRecipientName,
  parseRecipientNameInput,
  validateRecipientName
};
