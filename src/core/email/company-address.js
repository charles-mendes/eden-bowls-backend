// Company name and postal address shown in marketing emails, per market, from configuration:
// MAIL_COMPANY_<BR|US>_NAME, _TAX_ID, _STREET, _COMPLEMENT, _CITY, _STATE, _POSTAL_CODE, _COUNTRY.
const FIELDS = {
  name: 'NAME',
  taxId: 'TAX_ID',
  street: 'STREET',
  complement: 'COMPLEMENT',
  city: 'CITY',
  state: 'STATE',
  postalCode: 'POSTAL_CODE',
  country: 'COUNTRY'
};
const REQUIRED = ['name', 'street'];

function envKey(market, field) {
  return `MAIL_COMPANY_${String(market || '').toUpperCase()}_${FIELDS[field]}`;
}

function companyAddressFromEnv(market, env = process.env) {
  return Object.fromEntries(Object.keys(FIELDS).map((field) => [field, String(env[envKey(market, field)] || '').trim()]));
}

// Settings a real send needs and that are empty, by variable name.
function missingCompanyAddress(market, env = process.env) {
  const address = companyAddressFromEnv(market, env);
  return REQUIRED.filter((field) => !address[field]).map((field) => envKey(market, field));
}

// BR: "Empresa · CNPJ 00.000.000/0000-00 · Rua X, 94, Bairro, Curitiba – PR, CEP 82950-130".
// US: "Company · 6200 NW 2nd Ave, Boca Raton, FL 33487-3021, USA".
function formatCompanyAddress(market, address = {}) {
  const join = (parts, separator) => parts.filter(Boolean).join(separator);
  if (!address.name && !address.street) return '';
  if (String(market || '').toUpperCase() === 'BR') {
    const cityState = join([address.city, address.state], ' – ');
    const place = join([address.street, address.complement, cityState, address.postalCode ? `CEP ${address.postalCode}` : ''], ', ');
    return join([address.name, address.taxId ? `CNPJ ${address.taxId}` : '', place], ' · ');
  }
  const stateZip = join([address.state, address.postalCode], ' ');
  const place = join([address.street, address.complement, address.city, stateZip, address.country], ', ');
  return join([address.name, address.taxId, place], ' · ');
}

module.exports = {
  companyAddressFromEnv,
  formatCompanyAddress,
  missingCompanyAddress
};
