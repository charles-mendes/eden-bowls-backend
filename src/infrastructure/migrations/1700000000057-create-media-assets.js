const { Table } = require('typeorm');

const TABLE = 'media_assets';

// Admin image library (plan-image-library). A row is never deleted: archived_at only hides it from the list,
// and its file stays served. sha256 is of the uploaded bytes; MySQL lets several NULLs share the unique key,
// so backfilled rows without a hash do not collide.
class CreateMediaAssets1700000000057 {
  name = 'CreateMediaAssets1700000000057';

  async up(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: TABLE,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'kind', type: 'varchar', length: '16', isNullable: false },
        { name: 'market', type: 'varchar', length: '8', isNullable: false },
        { name: 'url', type: 'varchar', length: '512', isNullable: false },
        { name: 'original_filename', type: 'varchar', length: '255', isNullable: false },
        { name: 'mime_type', type: 'varchar', length: '32', isNullable: false },
        { name: 'width', type: 'int', unsigned: true, isNullable: true },
        { name: 'height', type: 'int', unsigned: true, isNullable: true },
        { name: 'bytes', type: 'int', unsigned: true, isNullable: true },
        { name: 'sha256', type: 'char', length: '64', isNullable: true },
        { name: 'uploaded_by', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'archived_at', type: 'datetime', isNullable: true }
      ],
      uniques: [
        { name: 'uniq_media_assets_market_kind_sha256', columnNames: ['market', 'kind', 'sha256'] }
      ]
    }), true);
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreateMediaAssets1700000000057
};
