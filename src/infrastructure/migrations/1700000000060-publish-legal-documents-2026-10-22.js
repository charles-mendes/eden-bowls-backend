const { LEGAL_2026_10_22_DOCUMENTS, LEGAL_2026_10_22_VERSION } = require('./helpers/legal-documents-2026-10-22');

const TABLE = 'legal_documents';

// Publishes the privacy policy and terms of use of 22/10/2026 in both markets (legal-documents). published_at is
// the deploy time, so this becomes the current version. A version already published with this id, by an admin or
// a rerun, is kept: versions are never edited.
class PublishLegalDocuments1700000000060 {
  name = 'PublishLegalDocuments1700000000060';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    for (const document of LEGAL_2026_10_22_DOCUMENTS) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE}\` (market, kind, version, body_markdown) VALUES (?, ?, ?, ?)`,
        [document.market, document.kind, LEGAL_2026_10_22_VERSION, document.body]
      );
    }
  }

  // Removes only the rows this migration wrote (no publisher); a version an admin published stays.
  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    await queryRunner.query(
      `DELETE FROM \`${TABLE}\` WHERE version = ? AND published_by IS NULL`,
      [LEGAL_2026_10_22_VERSION]
    );
  }
}

module.exports = {
  PublishLegalDocuments1700000000060
};
