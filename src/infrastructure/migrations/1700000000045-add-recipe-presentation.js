const { TableColumn } = require('typeorm');
const { seedRecipePresentation } = require('./helpers/seed-recipe-presentations');

const TABLE = 'recipe_contents';

// Recipe page presentation of the store (title, tagline, resume, highlights and colors), saved whole in the
// admin. The store recipes get the presentation the store shows today; a presentation saved in the admin is kept.
class AddRecipePresentation1700000000045 {
  name = 'AddRecipePresentation1700000000045';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, 'presentation'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'presentation', type: 'json', isNullable: true }));
    }
    if (!(await queryRunner.hasColumn(TABLE, 'presentation_updated_at'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({ name: 'presentation_updated_at', type: 'datetime', isNullable: true }));
    }
    const rows = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey FROM \`${TABLE}\` WHERE presentation IS NULL`);

    for (const row of Array.isArray(rows) ? rows : []) {
      const seed = seedRecipePresentation(String(row.market || '').toUpperCase(), String(row.recipeKey || ''));
      if (seed) {
        await queryRunner.query(
          `UPDATE \`${TABLE}\` SET presentation = ?, presentation_updated_at = NOW() WHERE id = ? AND presentation IS NULL`,
          [JSON.stringify(seed), row.id]
        );
      }
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    for (const column of ['presentation_updated_at', 'presentation']) {
      if (await queryRunner.hasColumn(TABLE, column)) {
        await queryRunner.dropColumn(TABLE, column);
      }
    }
  }
}

module.exports = {
  AddRecipePresentation1700000000045
};
