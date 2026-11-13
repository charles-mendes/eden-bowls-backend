const { TableColumn, TableIndex } = require('typeorm');

const TABLE = 'recipe_contents';
const PRODUCT_INDEX = 'uniq_recipe_contents_product';

// Content becomes a 1:1 extension of its product (catalog-products): the product id, plus the flavor aliases and
// short label the variations copy. Nullable here; the split migration fills them and makes product_id required.
class AddRecipeContentProduct1700000000074 {
  name = 'AddRecipeContentProduct1700000000074';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, 'product_id'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'product_id', type: 'bigint', unsigned: true, isNullable: true }));
      await queryRunner.createIndex(TABLE, new TableIndex({ name: PRODUCT_INDEX, columnNames: ['product_id'], isUnique: true }));
    }
    if (!(await queryRunner.hasColumn(TABLE, 'flavor_aliases'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'flavor_aliases', type: 'varchar', length: '512', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(TABLE, 'short_label'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'short_label', type: 'varchar', length: '120', isNullable: true }));
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (await queryRunner.hasColumn(TABLE, 'product_id')) {
      await queryRunner.dropIndex(TABLE, PRODUCT_INDEX);
    }
    for (const column of ['short_label', 'flavor_aliases', 'product_id']) {
      if (await queryRunner.hasColumn(TABLE, column)) {
        await queryRunner.dropColumn(TABLE, column);
      }
    }
  }
}

module.exports = {
  AddRecipeContentProduct1700000000074
};
