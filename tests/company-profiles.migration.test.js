const { CreateCompanyProfiles1700000000050 } = require('../src/infrastructure/migrations/1700000000050-create-company-profiles');
const { AddInvoiceIssuerSnapshot1700000000051, PRINTED_ISSUERS } = require('../src/infrastructure/migrations/1700000000051-add-invoice-issuer-snapshot');
const { COMPANY_PROFILE_SEED } = require('../src/core/company-profile');
const { issuerFor } = require('../src/core/invoice/invoice-copy');

function queryRunner({ hasTable = false, hasColumn = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    hasColumn: jest.fn().mockResolvedValue(hasColumn),
    createTable: jest.fn(),
    dropTable: jest.fn(),
    addColumn: jest.fn(),
    dropColumn: jest.fn(),
    query: jest.fn()
  };
}

describe('CreateCompanyProfiles1700000000050', () => {
  test('creates the table and seeds BR and US with the data printed today', async () => {
    const runner = queryRunner();

    await new CreateCompanyProfiles1700000000050().up(runner);

    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('company_profiles');
    expect(table.columns.map((column) => column.name)).toEqual([
      'market', 'legal_name', 'tax_id', 'street', 'complement', 'city', 'state', 'postal_code', 'country',
      'support_email', 'store_url', 'updated_by', 'created_at', 'updated_at'
    ]);
    const inserts = runner.query.mock.calls.filter(([sql]) => sql.includes('INSERT IGNORE'));
    expect(inserts.map(([, params]) => params)).toEqual([
      ['BR', 'C. C. J. Lovato Ltda', '65.291.985/0001-05', 'Rua Delmiro Fetter dos Santos, 94', 'Cajuru', 'Curitiba', 'PR', '82950-130', 'BR', 'hello@edenbowls.com', 'https://edenbowls.com'],
      ['US', 'EZER ONE INC (Eden Bowls)', '', '6200 NW 2nd Ave', '', 'Boca Raton', 'FL', '33487-3021', 'USA', 'hello@edenbowls.com', 'https://edenbowls.com']
    ]);
  });

  test('down removes the table', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateCompanyProfiles1700000000050().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('company_profiles');
  });
});

describe('AddInvoiceIssuerSnapshot1700000000051', () => {
  test('adds the column and fills every invoice with what it printed', async () => {
    const runner = queryRunner({ hasTable: true });

    await new AddInvoiceIssuerSnapshot1700000000051().up(runner);

    expect(runner.addColumn.mock.calls[0][1].name).toBe('issuer_snapshot');
    const updates = runner.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
    expect(updates).toHaveLength(2);
    expect(updates[0][0]).toContain("issuer_snapshot IS NULL AND locale = 'pt-BR'");
    expect(updates[1][0]).toContain("issuer_snapshot IS NULL AND locale <> 'pt-BR'");
    expect(JSON.parse(updates[0][1][0]).line).toBe('Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR');
    expect(JSON.parse(updates[1][1][0]).line).toBe('Eden Bowls · Boca Raton, FL, USA');
  });

  test('the backfill is what the seeded profiles compose', () => {
    expect(issuerFor('pt-BR', COMPANY_PROFILE_SEED.BR)).toEqual(PRINTED_ISSUERS['pt-BR']);
    expect(issuerFor('en-US', COMPANY_PROFILE_SEED.US)).toEqual(PRINTED_ISSUERS['en-US']);
  });

  test('down removes the column', async () => {
    const runner = queryRunner({ hasTable: true, hasColumn: true });
    await new AddInvoiceIssuerSnapshot1700000000051().down(runner);
    expect(runner.dropColumn).toHaveBeenCalledWith('customer_invoices', 'issuer_snapshot');
  });
});
