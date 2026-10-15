const { Table, TableIndex } = require('typeorm');

const TABLE_NAME = 'catalog_sync_runs';
const MARKET_INDEX = 'idx_catalog_sync_runs_market_id';

// One row per market a catalog price sync touched, including failed runs. The repository keeps the
// newest 50 rows per market.
class CreateCatalogSyncRuns1700000000032 {
  name = 'CreateCatalogSyncRuns1700000000032';

  async up(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      return;
    }
    await queryRunner.createTable(new Table({
      name: TABLE_NAME,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'market', type: 'varchar', length: '2', isNullable: false },
        { name: 'currency', type: 'varchar', length: '3', isNullable: true },
        { name: 'scope', type: 'varchar', length: '16', isNullable: false },
        { name: 'product_id', type: 'varchar', length: '32', isNullable: true },
        { name: 'status', type: 'varchar', length: '32', isNullable: false },
        { name: 'summary', type: 'json', isNullable: true },
        { name: 'error', type: 'varchar', length: '500', isNullable: true },
        { name: 'started_at', type: 'datetime', isNullable: false },
        { name: 'finished_at', type: 'datetime', isNullable: false }
      ]
    }), true);
    await queryRunner.createIndex(TABLE_NAME, new TableIndex({
      name: MARKET_INDEX,
      columnNames: ['market', 'id']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE_NAME)) {
      await queryRunner.dropTable(TABLE_NAME);
    }
  }
}

module.exports = {
  CreateCatalogSyncRuns1700000000032
};
