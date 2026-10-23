const { Table, TableIndex } = require('typeorm');

const TABLE = 'recipe_contents';

class CreateRecipeContents1700000000038 {
  name = 'CreateRecipeContents1700000000038';

  async up(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      return;
    }

    // One row per market and flavor slug, shared by every size of that flavor in the market's product.
    await queryRunner.createTable(new Table({
      name: TABLE,
      columns: [
        { name: 'id', type: 'int', unsigned: true, isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'market', type: 'varchar', length: '8', isNullable: false },
        { name: 'flavor_slug', type: 'varchar', length: '64', isNullable: false },
        { name: 'image_url', type: 'varchar', length: '512', isNullable: true },
        { name: 'image_updated_at', type: 'datetime', isNullable: true },
        { name: 'label', type: 'json', isNullable: true },
        { name: 'label_updated_at', type: 'datetime', isNullable: true },
        { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);
    await queryRunner.createIndex(TABLE, new TableIndex({
      name: 'uniq_recipe_contents_market_flavor',
      columnNames: ['market', 'flavor_slug'],
      isUnique: true
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreateRecipeContents1700000000038
};
