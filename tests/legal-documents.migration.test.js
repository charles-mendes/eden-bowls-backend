const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CreateLegalDocuments1700000000052 } = require('../src/infrastructure/migrations/1700000000052-create-legal-documents');
const { LEGAL_DOCUMENT_SEED } = require('../src/infrastructure/migrations/helpers/seed-legal-documents');

function queryRunner({ hasTable = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn(),
    createIndex: jest.fn(),
    dropTable: jest.fn(),
    query: jest.fn()
  };
}

describe('CreateLegalDocuments1700000000052', () => {
  test('publishes version 2026-09-13 of both kinds in both markets', async () => {
    const runner = queryRunner();

    await new CreateLegalDocuments1700000000052().up(runner);

    expect(runner.createTable.mock.calls[0][0].name).toBe('legal_documents');
    expect(runner.createIndex.mock.calls[0][1]).toMatchObject({ isUnique: true, columnNames: ['market', 'kind', 'version'] });
    const inserts = runner.query.mock.calls.filter(([sql]) => sql.includes('INSERT IGNORE'));
    expect(inserts.map(([, [market, kind, version]]) => `${market} ${kind} ${version}`)).toEqual([
      'BR privacy 2026-09-13', 'BR terms 2026-09-13', 'US privacy 2026-09-13', 'US terms 2026-09-13'
    ]);
  });

  test('each body is the store file it was copied from', () => {
    for (const document of LEGAL_DOCUMENT_SEED) {
      expect(crypto.createHash('sha256').update(document.body).digest('hex')).toBe(document.sha256);
      const source = path.join(__dirname, '..', '..', document.source);
      // The store sits next to this repository locally; CI checks the recorded hash only.
      if (fs.existsSync(source)) {
        expect(document.body).toBe(fs.readFileSync(source, 'utf8'));
      }
    }
    expect(LEGAL_DOCUMENT_SEED[0].body).toContain('versão `2026-09-13`');
  });

  test('a rerun does not duplicate: the table exists and the inserts ignore the unique key', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateLegalDocuments1700000000052().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.query.mock.calls.every(([sql]) => sql.startsWith('INSERT IGNORE'))).toBe(true);
  });

  test('down removes the table', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateLegalDocuments1700000000052().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('legal_documents');
  });
});
