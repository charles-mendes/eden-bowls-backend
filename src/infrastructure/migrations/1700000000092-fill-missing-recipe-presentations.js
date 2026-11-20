const { seedRecipePresentation } = require('./helpers/seed-recipe-presentations');

const TABLE = 'recipe_contents';

// Recipe rows registered after 1700000000045 (the US puppy and senior products) were left without a store
// presentation. Fills only empty presentations from the store texts, so one saved in the admin is kept.
class FillMissingRecipePresentations1700000000092 {
  name = 'FillMissingRecipePresentations1700000000092';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE)) || !(await queryRunner.hasColumn(TABLE, 'presentation'))) {
      return;
    }
    const rows = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey FROM \`${TABLE}\` WHERE presentation IS NULL`);
    for (const row of Array.isArray(rows) ? rows : []) {
      const seed = seedRecipePresentation(String(row.market || '').toUpperCase(), String(row.recipeKey || ''));
      if (!seed) {
        continue;
      }
      await queryRunner.query(
        `UPDATE \`${TABLE}\` SET presentation = ?, presentation_updated_at = NOW() WHERE id = ? AND presentation IS NULL`,
        [JSON.stringify(seed), row.id]
      );
    }
  }

  // The filled presentations can be edited in the admin since, so they stay.
  async down() {}
}

module.exports = {
  FillMissingRecipePresentations1700000000092
};
