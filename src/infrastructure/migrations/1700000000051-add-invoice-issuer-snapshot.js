const { TableColumn } = require('typeorm');

const TABLE = 'customer_invoices';
const COLUMN = 'issuer_snapshot';

// What every invoice issued before company_profiles printed as its issuer, per locale. Written literally so
// the backfill stays what those PDFs show, whatever the profile says later.
const PRINTED_ISSUERS = {
  'en-US': { name: 'Eden Bowls', line: 'Eden Bowls · Boca Raton, FL, USA', email: 'hello@edenbowls.com' },
  'pt-BR': { name: 'Eden Bowls', line: 'Eden Bowls · CNPJ 65.291.985/0001-05 · Curitiba, PR', email: 'hello@edenbowls.com' }
};

// The issuer an invoice printed when it received its number (company-profile), so writing its PDF again keeps
// it after a profile change.
class AddInvoiceIssuerSnapshot1700000000051 {
  name = 'AddInvoiceIssuerSnapshot1700000000051';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, COLUMN))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: COLUMN, type: 'json', isNullable: true }));
    }
    await queryRunner.query(
      `UPDATE \`${TABLE}\` SET ${COLUMN} = ? WHERE ${COLUMN} IS NULL AND locale = 'pt-BR'`,
      [JSON.stringify(PRINTED_ISSUERS['pt-BR'])]
    );
    await queryRunner.query(
      `UPDATE \`${TABLE}\` SET ${COLUMN} = ? WHERE ${COLUMN} IS NULL AND locale <> 'pt-BR'`,
      [JSON.stringify(PRINTED_ISSUERS['en-US'])]
    );
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, COLUMN))) {
      await queryRunner.dropColumn(TABLE, COLUMN);
    }
  }
}

module.exports = {
  AddInvoiceIssuerSnapshot1700000000051,
  PRINTED_ISSUERS
};
