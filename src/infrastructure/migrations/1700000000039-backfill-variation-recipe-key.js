const { canonicalFlavorKey, FLAVOR_SLUG_META } = require('../../core/flavors');
const { RECIPE_KEY_META } = require('../../core/recipe-content');

const POSTS_TABLE = 'wp_posts';
const POSTMETA_TABLE = 'wp_postmeta';

// Stores on each variation the recipe key it was derived to before the explicit link (recipe-content), so the
// deploy changes nothing and operators correct the link where the alias picked the wrong recipe.
class BackfillVariationRecipeKey1700000000039 {
  name = 'BackfillVariationRecipeKey1700000000039';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(POSTS_TABLE)) || !(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }
    const rows = await queryRunner.query(
      `SELECT v.\`ID\` AS id, UPPER(COALESCE(pc.\`meta_value\`, '')) AS market,
              MAX(CASE WHEN vm.\`meta_key\` = ? THEN vm.\`meta_value\` END) AS flavorSlug,
              MAX(CASE WHEN vm.\`meta_key\` = 'attribute_pa_flavor' THEN vm.\`meta_value\` END) AS label
       FROM \`${POSTS_TABLE}\` v
       INNER JOIN \`${POSTS_TABLE}\` p ON p.\`ID\` = v.\`post_parent\` AND p.\`post_type\` = 'product'
       LEFT JOIN \`${POSTMETA_TABLE}\` pc ON pc.\`post_id\` = p.\`ID\` AND pc.\`meta_key\` = '_cmpb_plan_country'
       LEFT JOIN \`${POSTMETA_TABLE}\` vm ON vm.\`post_id\` = v.\`ID\`
       WHERE v.\`post_type\` = 'product_variation'
         AND NOT EXISTS (SELECT 1 FROM \`${POSTMETA_TABLE}\` k WHERE k.\`post_id\` = v.\`ID\` AND k.\`meta_key\` = ?)
       GROUP BY v.\`ID\`, pc.\`meta_value\``,
      [FLAVOR_SLUG_META, RECIPE_KEY_META]
    );

    for (const row of Array.isArray(rows) ? rows : []) {
      const key = canonicalFlavorKey(row.flavorSlug || row.label || '', row.market || undefined);
      if (!key) {
        continue;
      }
      await queryRunner.query(
        `INSERT INTO \`${POSTMETA_TABLE}\` (\`post_id\`, \`meta_key\`, \`meta_value\`) VALUES (?, ?, ?)`,
        [row.id, RECIPE_KEY_META, key]
      );
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }
    await queryRunner.query(`DELETE FROM \`${POSTMETA_TABLE}\` WHERE \`meta_key\` = ?`, [RECIPE_KEY_META]);
  }
}

module.exports = {
  BackfillVariationRecipeKey1700000000039
};
