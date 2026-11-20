const { seedRecipeLabel } = require('./helpers/seed-recipe-labels');

const TABLE = 'recipe_contents';

// Recipe rows registered after 1700000000041 (the US puppy and senior products) were left without a
// label. Fills only empty labels from the veterinarian's files, so a label saved in the admin is kept.
class FillMissingRecipeLabels1700000000091 {
  name = 'FillMissingRecipeLabels1700000000091';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    const rows = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey FROM \`${TABLE}\` WHERE label IS NULL`);
    for (const row of Array.isArray(rows) ? rows : []) {
      const seed = seedRecipeLabel(String(row.market || '').toUpperCase(), String(row.recipeKey || ''));
      if (!seed) {
        continue;
      }
      await queryRunner.query(
        `UPDATE \`${TABLE}\` SET label = ?, label_updated_at = NOW() WHERE id = ? AND label IS NULL`,
        [JSON.stringify(seed), row.id]
      );
    }
  }

  // The filled labels can be edited in the admin since, so they stay.
  async down() {}
}

module.exports = {
  FillMissingRecipeLabels1700000000091
};
