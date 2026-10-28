const { Table, TableIndex } = require('typeorm');
const { LEGAL_DOCUMENT_SEED, LEGAL_SEED_VERSION } = require('./helpers/seed-legal-documents');

const TABLE = 'legal_documents';

// Published versions of the privacy policy and terms of use per market (legal-documents, design decision 6).
// A version is never edited; the deploy publishes 2026-09-13, the text the store showed, and a rerun keeps it.
class CreateLegalDocuments1700000000052 {
  name = 'CreateLegalDocuments1700000000052';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'market', type: 'varchar', length: '8', isNullable: false },
          { name: 'kind', type: 'varchar', length: '16', isNullable: false },
          { name: 'version', type: 'varchar', length: '10', isNullable: false },
          { name: 'body_markdown', type: 'mediumtext', isNullable: false },
          { name: 'published_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'published_by', type: 'bigint', unsigned: true, isNullable: true }
        ]
      }), true);
      await queryRunner.createIndex(TABLE, new TableIndex({
        name: 'uniq_legal_documents_market_kind_version',
        columnNames: ['market', 'kind', 'version'],
        isUnique: true
      }));
    }
    for (const document of LEGAL_DOCUMENT_SEED) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE}\` (market, kind, version, body_markdown, published_at) VALUES (?, ?, ?, ?, ?)`,
        [document.market, document.kind, LEGAL_SEED_VERSION, document.body, '2026-09-13 00:00:00']
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
  CreateLegalDocuments1700000000052
};
