const { parseJsonColumn } = require('./stripe-subscription-map');
const { isPoBoxAddress } = require('./po-box');

// What keeps a box from leaving because of its address (courier-delivery, ups-label-queue, delivery-address-issues).
// Every reader accepts the keys already stored: the checkout writes `street` and `line1`, `zipcode` and
// `postal_code`, so a reader of one key only would block an address that is complete.
const KEYS = {
  street: ['street', 'line1', 'address_line1', 'address', 'address1'],
  number: ['number'],
  complement: ['complement', 'line2', 'address_line2', 'street2', 'address2'],
  neighborhood: ['neighborhood'],
  city: ['city'],
  state: ['state', 'region'],
  zipcode: ['zipcode', 'postal_code', 'zipCode', 'postalCode', 'postal'],
  recipient: ['recipient_name', 'name', 'full_name', 'recipient']
};

function addressObject(address) {
  return parseJsonColumn(address) || {};
}

// The first non-empty value of a field, trimmed, or ''.
function addressField(address, field) {
  const value = addressObject(address);
  for (const key of KEYS[field] || [field]) {
    const text = String(value[key] == null ? '' : value[key]).trim();
    if (text) return text;
  }
  return '';
}

// UPS does not deliver to US military mail: APO, FPO and DPO cities, or the AA, AE and AP states.
function isMilitaryAddress({ city = '', state = '' } = {}) {
  return ['APO', 'FPO', 'DPO'].includes(String(city).trim().toUpperCase())
    || ['AA', 'AE', 'AP'].includes(String(state).trim().toUpperCase());
}

// Every Brazil address field the courier needs, as stable codes, empty when the address passes.
function brazilAddressIssues(address) {
  const issues = [];
  if (!addressField(address, 'street')) issues.push('address_street_missing');
  if (!addressField(address, 'number')) issues.push('address_number_missing');
  if (!addressField(address, 'neighborhood')) issues.push('address_neighborhood_missing');
  if (!addressField(address, 'city')) issues.push('address_city_missing');
  if (!addressField(address, 'state')) issues.push('address_state_missing');
  if (addressField(address, 'zipcode').replace(/\D/g, '').length !== 8) issues.push('address_zipcode_invalid');
  if (!addressField(address, 'recipient')) issues.push('recipient_name_missing');
  return issues;
}

// The one US address reason a label stops on, in the order UPS checks it today, or null. The country and the
// recipient name are checked by the label inspection itself (with its account-name fallback), not here.
function usAddressIssue(address) {
  const street = addressField(address, 'street');
  const city = addressField(address, 'city');
  const state = addressField(address, 'state');
  if (isPoBoxAddress(street, addressField(address, 'complement'))) return 'po_box_not_allowed';
  if (isMilitaryAddress({ city, state })) return 'military_address_not_supported';
  if (![street, city, state, addressField(address, 'zipcode')].every(Boolean)) return 'address_incomplete';
  return null;
}

function usAddressIssues(address) {
  const issue = usAddressIssue(address);
  return issue ? [issue] : [];
}

// Payload field names a saved address lacks (subscription-contract), for the store to mark field by field.
function missingAddressFields(address, country) {
  const brazil = String(country || '').toUpperCase() === 'BR';
  const required = brazil
    ? [['street', 'street'], ['number', 'number'], ['neighborhood', 'neighborhood'], ['city', 'city'], ['state', 'state'], ['zipcode', 'postal_code']]
    : [['street', 'street'], ['city', 'city'], ['state', 'state'], ['zipcode', 'postal_code']];
  return required.filter(([field]) => !addressField(address, field)).map(([, name]) => name);
}

module.exports = {
  ADDRESS_KEYS: KEYS,
  addressField,
  brazilAddressIssues,
  isMilitaryAddress,
  missingAddressFields,
  usAddressIssue,
  usAddressIssues
};
