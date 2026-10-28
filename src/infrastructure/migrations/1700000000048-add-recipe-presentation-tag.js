const { seedRecipePresentation } = require('./helpers/seed-recipe-presentations');

const TABLE = 'recipe_contents';
const MAX_TAG_LENGTH = 40;

function parse(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

// Short name of a stored presentation, which the store showed from its recipe Markdown before: the store tag
// for the store recipes, else the recipe name, so every stored presentation stays valid.
class AddRecipePresentationTag1700000000048 {
  name = 'AddRecipePresentationTag1700000000048';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE)) || !(await queryRunner.hasColumn(TABLE, 'presentation'))) {
      return;
    }
    const rows = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey, name, presentation FROM \`${TABLE}\` WHERE presentation IS NOT NULL`);

    for (const row of Array.isArray(rows) ? rows : []) {
      const presentation = parse(row.presentation);
      if (!presentation || String(presentation.tag || '').trim()) {
        continue;
      }
      const seed = seedRecipePresentation(String(row.market || '').toUpperCase(), String(row.recipeKey || ''));
      const tag = (seed ? seed.tag : String(row.name || row.recipeKey || '').trim()).slice(0, MAX_TAG_LENGTH);
      await queryRunner.query(
        `UPDATE \`${TABLE}\` SET presentation = ? WHERE id = ?`,
        [JSON.stringify({ tag, ...presentation }), row.id]
      );
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE)) || !(await queryRunner.hasColumn(TABLE, 'presentation'))) {
      return;
    }
    await queryRunner.query(`UPDATE \`${TABLE}\` SET presentation = JSON_REMOVE(presentation, '$.tag') WHERE presentation IS NOT NULL`);
  }
}

module.exports = {
  AddRecipePresentationTag1700000000048
};
