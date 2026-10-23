const { companyAddressFromEnv, formatCompanyAddress, missingCompanyAddress } = require('../src/core/email/company-address');

const ENV = {
  MAIL_COMPANY_BR_NAME: 'C. C. J. Lovato Ltda',
  MAIL_COMPANY_BR_TAX_ID: '65.291.985/0001-05',
  MAIL_COMPANY_BR_STREET: 'Rua Delmiro Fetter dos Santos, 94',
  MAIL_COMPANY_BR_COMPLEMENT: 'Cajuru',
  MAIL_COMPANY_BR_CITY: 'Curitiba',
  MAIL_COMPANY_BR_STATE: 'PR',
  MAIL_COMPANY_BR_POSTAL_CODE: '82950-130',
  MAIL_COMPANY_BR_COUNTRY: 'BR',
  MAIL_COMPANY_US_NAME: 'EZER ONE INC (Eden Bowls)',
  MAIL_COMPANY_US_STREET: '6200 NW 2nd Ave',
  MAIL_COMPANY_US_CITY: 'Boca Raton',
  MAIL_COMPANY_US_STATE: 'FL',
  MAIL_COMPANY_US_POSTAL_CODE: '33487-3021',
  MAIL_COMPANY_US_COUNTRY: 'USA'
};

describe('company address of marketing emails', () => {
  test('formats the BR and US lines from configuration fields', () => {
    expect(formatCompanyAddress('BR', companyAddressFromEnv('BR', ENV))).toBe(
      'C. C. J. Lovato Ltda · CNPJ 65.291.985/0001-05 · Rua Delmiro Fetter dos Santos, 94, Cajuru, Curitiba – PR, CEP 82950-130'
    );
    expect(formatCompanyAddress('US', companyAddressFromEnv('US', ENV))).toBe(
      'EZER ONE INC (Eden Bowls) · 6200 NW 2nd Ave, Boca Raton, FL 33487-3021, USA'
    );
  });

  test('names the missing company name or street', () => {
    expect(missingCompanyAddress('BR', ENV)).toEqual([]);
    expect(missingCompanyAddress('US', { ...ENV, MAIL_COMPANY_US_NAME: ' ', MAIL_COMPANY_US_STREET: '' }))
      .toEqual(['MAIL_COMPANY_US_NAME', 'MAIL_COMPANY_US_STREET']);
  });

  test('the .env examples carry both markets', () => {
    const dotenv = require('dotenv');
    const fs = require('fs');
    const path = require('path');
    for (const file of ['.env.example', '.env.qa.example']) {
      const parsed = dotenv.parse(fs.readFileSync(path.join(__dirname, '..', file)));
      expect(formatCompanyAddress('BR', companyAddressFromEnv('BR', parsed))).toBe(formatCompanyAddress('BR', companyAddressFromEnv('BR', ENV)));
      expect(formatCompanyAddress('US', companyAddressFromEnv('US', parsed))).toBe(formatCompanyAddress('US', companyAddressFromEnv('US', ENV)));
    }
  });
});
