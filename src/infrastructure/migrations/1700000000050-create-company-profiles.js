const { Table } = require('typeorm');
const { COMPANY_PROFILE_SEED } = require('../../core/company-profile');

const TABLE = 'company_profiles';

// One company profile per market (company-profile), seeded with the data printed on invoices and emails
// before the table existed. A profile already present is kept.
class CreateCompanyProfiles1700000000050 {
  name = 'CreateCompanyProfiles1700000000050';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'market', type: 'varchar', length: '8', isPrimary: true },
          { name: 'legal_name', type: 'varchar', length: '191', isNullable: false },
          { name: 'tax_id', type: 'varchar', length: '32', isNullable: false, default: "''" },
          { name: 'street', type: 'varchar', length: '191', isNullable: false },
          { name: 'complement', type: 'varchar', length: '191', isNullable: false, default: "''" },
          { name: 'city', type: 'varchar', length: '120', isNullable: false },
          { name: 'state', type: 'varchar', length: '60', isNullable: false },
          { name: 'postal_code', type: 'varchar', length: '20', isNullable: false },
          { name: 'country', type: 'varchar', length: '60', isNullable: false },
          { name: 'support_email', type: 'varchar', length: '191', isNullable: false },
          { name: 'store_url', type: 'varchar', length: '191', isNullable: false },
          { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }
    for (const [market, profile] of Object.entries(COMPANY_PROFILE_SEED)) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE}\`
           (market, legal_name, tax_id, street, complement, city, state, postal_code, country, support_email, store_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [market, profile.legalName, profile.taxId, profile.street, profile.complement, profile.city, profile.state,
          profile.postalCode, profile.country, profile.supportEmail, profile.storeUrl]
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreateCompanyProfiles1700000000050
};
