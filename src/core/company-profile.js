const { HttpError } = require('./http-error');

const COMPANY_PROFILE_INVALID = 'company_profile_invalid';
const COMPANY_MARKETS = ['BR', 'US'];

// The company data printed on invoices and emails before company_profiles existed (company-profile). The
// migration seeds both profiles with it, so every printed line stays the same after the deploy.
const COMPANY_PROFILE_SEED = Object.freeze({
  BR: Object.freeze({
    legalName: 'C. C. J. Lovato Ltda',
    taxId: '65.291.985/0001-05',
    street: 'Rua Delmiro Fetter dos Santos, 94',
    complement: 'Cajuru',
    city: 'Curitiba',
    state: 'PR',
    postalCode: '82950-130',
    country: 'BR',
    supportEmail: 'hello@edenbowls.com',
    storeUrl: 'https://edenbowls.com'
  }),
  US: Object.freeze({
    legalName: 'EZER ONE INC (Eden Bowls)',
    taxId: '',
    street: '6200 NW 2nd Ave',
    complement: '',
    city: 'Boca Raton',
    state: 'FL',
    postalCode: '33487-3021',
    country: 'USA',
    supportEmail: 'hello@edenbowls.com',
    storeUrl: 'https://edenbowls.com'
  })
});

// Request field → profile key, with the maximum length of its column.
const FIELDS = {
  legal_name: { key: 'legalName', max: 191, required: true },
  tax_id: { key: 'taxId', max: 32, required: false },
  street: { key: 'street', max: 191, required: true },
  complement: { key: 'complement', max: 191, required: false },
  city: { key: 'city', max: 120, required: true },
  state: { key: 'state', max: 60, required: true },
  postal_code: { key: 'postalCode', max: 20, required: true },
  country: { key: 'country', max: 60, required: true },
  support_email: { key: 'supportEmail', max: 191, required: true },
  store_url: { key: 'storeUrl', max: 191, required: true }
};

function companyMarket(market) {
  return String(market || '').trim().toUpperCase() === 'BR' ? 'BR' : 'US';
}

// A CNPJ with valid check digits, as `NN.NNN.NNN/NNNN-NN`, or null.
function formatCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) {
    return null;
  }
  const checkDigit = (length) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  if (checkDigit(12) !== Number(digits[12]) || checkDigit(13) !== Number(digits[13])) {
    return null;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

/**
 * A company profile from a request, or 422 `company_profile_invalid` listing every invalid field. The BR tax
 * id must be a CNPJ with valid check digits and is stored formatted; the US one may be empty.
 */
function parseCompanyProfile(market, input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const invalid = [];
  const profile = {};
  for (const [field, rule] of Object.entries(FIELDS)) {
    const raw = source[field];
    const value = raw == null ? '' : String(raw).trim().replace(/\s+/g, ' ');
    if ((rule.required && !value) || value.length > rule.max || (raw != null && typeof raw !== 'string')) {
      invalid.push(field);
    }
    profile[rule.key] = value;
  }
  if (market === 'BR') {
    const cnpj = formatCnpj(profile.taxId);
    if (cnpj) {
      profile.taxId = cnpj;
    } else if (!invalid.includes('tax_id')) {
      invalid.push('tax_id');
    }
  }
  if (profile.supportEmail && !isEmail(profile.supportEmail) && !invalid.includes('support_email')) {
    invalid.push('support_email');
  }
  if (profile.storeUrl && !isHttpsUrl(profile.storeUrl) && !invalid.includes('store_url')) {
    invalid.push('store_url');
  }
  if (invalid.length) {
    throw new HttpError(422, `Invalid company profile: ${invalid.join(', ')}.`, { code: COMPANY_PROFILE_INVALID, fields: invalid });
  }
  return profile;
}

// Request field names of a profile, as the admin reads them.
function companyProfilePayload(market, profile) {
  const payload = { market };
  for (const [field, rule] of Object.entries(FIELDS)) {
    payload[field] = profile[rule.key] == null ? '' : profile[rule.key];
  }
  return payload;
}

// Request fields whose value differs between two profiles.
function changedCompanyFields(before = {}, after = {}) {
  return Object.entries(FIELDS)
    .filter(([, rule]) => String(before[rule.key] || '') !== String(after[rule.key] || ''))
    .map(([field]) => field);
}

module.exports = {
  COMPANY_MARKETS,
  COMPANY_PROFILE_INVALID,
  COMPANY_PROFILE_SEED,
  changedCompanyFields,
  companyMarket,
  companyProfilePayload,
  formatCnpj,
  parseCompanyProfile
};
