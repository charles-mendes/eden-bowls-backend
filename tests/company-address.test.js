const fs = require('fs');
const path = require('path');
const { companyAddressFromProfile, formatCompanyAddress, missingCompanyAddress } = require('../src/core/email/company-address');
const { COMPANY_PROFILE_SEED } = require('../src/core/company-profile');

describe('company address of marketing emails', () => {
  test('the seeded profiles print the same BR and US lines as before', () => {
    expect(formatCompanyAddress('BR', companyAddressFromProfile(COMPANY_PROFILE_SEED.BR))).toBe(
      'C. C. J. Lovato Ltda · CNPJ 65.291.985/0001-05 · Rua Delmiro Fetter dos Santos, 94, Cajuru, Curitiba – PR, CEP 82950-130'
    );
    expect(formatCompanyAddress('US', companyAddressFromProfile(COMPANY_PROFILE_SEED.US))).toBe(
      'EZER ONE INC (Eden Bowls) · 6200 NW 2nd Ave, Boca Raton, FL 33487-3021, USA'
    );
  });

  test('names the missing legal name or street of the profile', () => {
    expect(missingCompanyAddress(COMPANY_PROFILE_SEED.BR)).toEqual([]);
    expect(missingCompanyAddress({ ...COMPANY_PROFILE_SEED.US, legalName: ' ', street: '' })).toEqual(['legal_name', 'street']);
  });

  test('the company address is no longer configured in the environment', () => {
    for (const file of ['.env.example', '.env.qa.example', '.env.proxy.example']) {
      expect(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).not.toMatch(/MAIL_COMPANY_/);
    }
    expect(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'email', 'company-address.js'), 'utf8')).not.toMatch(/process\.env|MAIL_COMPANY_/);
  });
});
