const { seedRecipeLabel, seedRecipeRegistrations } = require('./helpers/seed-recipe-labels');

const TABLE = 'recipe_contents';

// Registers the store recipes missing in a market (puppy and senior ones have no variation before their
// launch) and fills their label from the veterinarian's files, so the nutrition engine has the energyKg in
// every environment. A label saved in the admin is kept; one without energyKg gets only the two energy fields.
class SeedRecipeLabels1700000000041 {
  name = 'SeedRecipeLabels1700000000041';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    for (const { market, key, name } of seedRecipeRegistrations()) {
      await queryRunner.query(
        `INSERT INTO \`${TABLE}\` (market, flavor_slug, name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = name`,
        [market, key, name]
      );
    }
    const rows = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey, label FROM \`${TABLE}\``);

    for (const row of Array.isArray(rows) ? rows : []) {
      const seed = seedRecipeLabel(String(row.market || '').toUpperCase(), String(row.recipeKey || ''));
      if (!seed) {
        continue;
      }
      const current = typeof row.label === 'string' ? JSON.parse(row.label) : row.label;
      if (!current) {
        await queryRunner.query(
          `UPDATE \`${TABLE}\` SET label = ?, label_updated_at = NOW() WHERE id = ? AND label IS NULL`,
          [JSON.stringify(seed), row.id]
        );
      } else if (!String(current.energyKg || '').trim()) {
        const label = { ...current, energyKg: seed.energyKg };
        if (!String(current.energyPackage || '').trim()) {
          label.energyPackage = seed.energyPackage;
        }
        await queryRunner.query(
          `UPDATE \`${TABLE}\` SET label = ?, label_updated_at = NOW() WHERE id = ?`,
          [JSON.stringify(label), row.id]
        );
      }
    }
  }

  // The seeded labels can be edited in the admin since, so they stay.
  async down() {}
}

module.exports = {
  SeedRecipeLabels1700000000041
};
