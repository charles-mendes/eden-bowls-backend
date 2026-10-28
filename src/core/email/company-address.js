// Company name and postal address shown in marketing emails, per market, from the company profile
// (company_profiles, company-profile).
const REQUIRED = { name: 'legal_name', street: 'street' };

function companyAddressFromProfile(profile = {}) {
  const text = (value) => String(value == null ? '' : value).trim();
  return {
    name: text(profile.legalName),
    taxId: text(profile.taxId),
    street: text(profile.street),
    complement: text(profile.complement),
    city: text(profile.city),
    state: text(profile.state),
    postalCode: text(profile.postalCode),
    country: text(profile.country)
  };
}

// Profile fields a real send needs and that are empty.
function missingCompanyAddress(profile = {}) {
  const address = companyAddressFromProfile(profile);
  return Object.entries(REQUIRED).filter(([field]) => !address[field]).map(([, name]) => name);
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
  companyAddressFromProfile,
  formatCompanyAddress,
  missingCompanyAddress
};
