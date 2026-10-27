const { TableColumn } = require('typeorm');

const TABLE = 'recipe_contents';

// Square package thumbnail of the plan flavor picker (recipe-content), apart from the home banner.
class AddRecipePlanImage1700000000043 {
  name = 'AddRecipePlanImage1700000000043';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, 'plan_image_url'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'plan_image_url', type: 'varchar', length: '512', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(TABLE, 'plan_image_updated_at'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'plan_image_updated_at', type: 'datetime', isNullable: true }));
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    for (const column of ['plan_image_updated_at', 'plan_image_url']) {
      if (await queryRunner.hasColumn(TABLE, column)) {
        await queryRunner.dropColumn(TABLE, column);
      }
    }
  }
}

module.exports = {
  AddRecipePlanImage1700000000043
};
