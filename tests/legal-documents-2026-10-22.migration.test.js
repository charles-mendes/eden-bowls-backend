const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PublishLegalDocuments1700000000060 } = require('../src/infrastructure/migrations/1700000000060-publish-legal-documents-2026-10-22');
const { LEGAL_2026_10_22_DOCUMENTS } = require('../src/infrastructure/migrations/helpers/legal-documents-2026-10-22');
const { parseLegalPublication } = require('../src/core/legal-documents');

function queryRunner({ hasTable = true } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    query: jest.fn()
  };
}

describe('PublishLegalDocuments1700000000060', () => {
  test('publishes version 2026-10-22 of both kinds in both markets, keeping a version already there', async () => {
    const runner = queryRunner();

    await new PublishLegalDocuments1700000000060().up(runner);

    expect(runner.query.mock.calls.every(([sql]) => sql.startsWith('INSERT IGNORE'))).toBe(true);
    expect(runner.query.mock.calls.map(([, [market, kind, version]]) => `${market} ${kind} ${version}`)).toEqual([
      'BR privacy 2026-10-22', 'BR terms 2026-10-22', 'US privacy 2026-10-22', 'US terms 2026-10-22'
    ]);
  });

  test('each body is the converted file, a valid publication and without the page title', () => {
    for (const document of LEGAL_2026_10_22_DOCUMENTS) {
      expect(crypto.createHash('sha256').update(document.body).digest('hex')).toBe(document.sha256);
      expect(parseLegalPublication({ version: '2026-10-22', body_markdown: document.body }).body).toBe(document.body);
      expect(document.body).not.toMatch(/^# /m);
      const source = path.join(__dirname, '..', '..', document.source);
      // docs-new is local material; CI checks the recorded hash only.
      if (fs.existsSync(source)) {
        expect(document.body).toBe(fs.readFileSync(source, 'utf8'));
      }
    }
    const brPrivacy = LEGAL_2026_10_22_DOCUMENTS.find((document) => document.market === 'BR' && document.kind === 'privacy');
    expect(brPrivacy.body).toContain('| Finalidade | Dados usados | Base legal (LGPD, art. 7º) |');
  });

  test('without the table it does nothing', async () => {
    const runner = queryRunner({ hasTable: false });
    await new PublishLegalDocuments1700000000060().up(runner);
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('down removes only the rows the migration wrote', async () => {
    const runner = queryRunner();
    await new PublishLegalDocuments1700000000060().down(runner);
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('published_by IS NULL'), ['2026-10-22']);
  });
});
