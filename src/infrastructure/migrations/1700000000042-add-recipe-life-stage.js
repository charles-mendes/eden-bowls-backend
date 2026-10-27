const { TableColumn } = require('typeorm');
const { RECIPE_KEY_META } = require('../../core/recipe-content');
const { LIFE_STAGE_META, LIFE_STAGES } = require('../../core/flavors');

const TABLE = 'recipe_contents';
const POSTS_TABLE = 'wp_posts';
const POSTMETA_TABLE = 'wp_postmeta';

// Line of a key without variations: the puppy-/senior- prefix of the store recipe keys, else adult.
function lineOfKey(recipeKey) {
  const prefix = String(recipeKey || '').split('-')[0];
  return LIFE_STAGES.includes(prefix) ? prefix : 'adult';
}

// The recipe owns its life stage (recipe-content): it takes the line of its first published variation, or
// of its first variation, and every variation of the recipe is set to it.
class AddRecipeLifeStage1700000000042 {
  name = 'AddRecipeLifeStage1700000000042';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, 'life_stage'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({
        name: 'life_stage',
        type: 'varchar',
        length: '16',
        isNullable: false,
        default: "'adult'"
      }));
    }
    if (!(await queryRunner.hasTable(POSTS_TABLE)) || !(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }

    const variations = await queryRunner.query(
      `SELECT v.\`ID\` AS id, UPPER(COALESCE(pc.\`meta_value\`, '')) AS market, k.\`meta_value\` AS recipeKey,
              v.\`post_status\` = 'publish' AND p.\`post_status\` = 'publish' AS published,
              MAX(CASE WHEN vm.\`meta_key\` = ? THEN vm.\`meta_value\` END) AS lifeStage
       FROM \`${POSTS_TABLE}\` v
       INNER JOIN \`${POSTS_TABLE}\` p ON p.\`ID\` = v.\`post_parent\` AND p.\`post_type\` = 'product'
       INNER JOIN \`${POSTMETA_TABLE}\` k ON k.\`post_id\` = v.\`ID\` AND k.\`meta_key\` = ? AND k.\`meta_value\` <> ''
       LEFT JOIN \`${POSTMETA_TABLE}\` pc ON pc.\`post_id\` = p.\`ID\` AND pc.\`meta_key\` = '_cmpb_plan_country'
       LEFT JOIN \`${POSTMETA_TABLE}\` vm ON vm.\`post_id\` = v.\`ID\`
       WHERE v.\`post_type\` = 'product_variation'
       GROUP BY v.\`ID\`, pc.\`meta_value\`, k.\`meta_value\`, v.\`post_status\`, p.\`post_status\`
       ORDER BY v.\`ID\` ASC`,
      [LIFE_STAGE_META, RECIPE_KEY_META]
    );
    const byRecipe = new Map();
    for (const row of Array.isArray(variations) ? variations : []) {
      const key = `${String(row.market || '').trim()}:${String(row.recipeKey || '').trim()}`;
      (byRecipe.get(key) || byRecipe.set(key, []).get(key)).push(row);
    }

    const recipes = await queryRunner.query(`SELECT id, market, flavor_slug AS recipeKey FROM \`${TABLE}\``);
    for (const recipe of Array.isArray(recipes) ? recipes : []) {
      const rows = byRecipe.get(`${String(recipe.market || '').toUpperCase()}:${recipe.recipeKey}`) || [];
      const source = rows.find((row) => Number(row.published) === 1) || rows[0];
      const stored = source ? String(source.lifeStage || '').trim() : '';
      const lifeStage = LIFE_STAGES.includes(stored) ? stored : (source ? 'adult' : lineOfKey(recipe.recipeKey));
      await queryRunner.query(`UPDATE \`${TABLE}\` SET life_stage = ? WHERE id = ?`, [lifeStage, recipe.id]);
      for (const row of rows) {
        if (String(row.lifeStage || '').trim() === lifeStage) {
          continue;
        }
        await queryRunner.query(`DELETE FROM \`${POSTMETA_TABLE}\` WHERE post_id = ? AND meta_key = ?`, [row.id, LIFE_STAGE_META]);
        await queryRunner.query(
          `INSERT INTO \`${POSTMETA_TABLE}\` (post_id, meta_key, meta_value) VALUES (?, ?, ?)`,
          [row.id, LIFE_STAGE_META, lifeStage]
        );
      }
    }
  }

  // Variations keep the stage they were set to.
  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'life_stage'))) {
      await queryRunner.dropColumn(TABLE, 'life_stage');
    }
  }
}

module.exports = {
  AddRecipeLifeStage1700000000042
};
