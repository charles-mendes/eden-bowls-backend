const { TableColumn } = require('typeorm');
const { RECIPE_KEY_META } = require('../../core/recipe-content');

const TABLE = 'recipe_contents';
const POSTS_TABLE = 'wp_posts';
const POSTMETA_TABLE = 'wp_postmeta';

// A recipe_contents row is the recipe registration (recipe-content): it gets a name, and every key the
// variations already use is registered, named after the flavor label of its first variation.
class AddRecipeRegistry1700000000040 {
  name = 'AddRecipeRegistry1700000000040';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    if (!(await queryRunner.hasColumn(TABLE, 'name'))) {
      await queryRunner.addColumn(TABLE, new TableColumn({
        name: 'name',
        type: 'varchar',
        length: '120',
        isNullable: false,
        default: "''"
      }));
    }
    if (!(await queryRunner.hasTable(POSTS_TABLE)) || !(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }

    const rows = await queryRunner.query(
      `SELECT v.\`ID\` AS id, UPPER(COALESCE(pc.\`meta_value\`, '')) AS market, k.\`meta_value\` AS recipeKey,
              MAX(CASE WHEN vm.\`meta_key\` = 'attribute_pa_flavor' THEN vm.\`meta_value\` END) AS label
       FROM \`${POSTS_TABLE}\` v
       INNER JOIN \`${POSTS_TABLE}\` p ON p.\`ID\` = v.\`post_parent\` AND p.\`post_type\` = 'product'
       INNER JOIN \`${POSTMETA_TABLE}\` k ON k.\`post_id\` = v.\`ID\` AND k.\`meta_key\` = ? AND k.\`meta_value\` <> ''
       LEFT JOIN \`${POSTMETA_TABLE}\` pc ON pc.\`post_id\` = p.\`ID\` AND pc.\`meta_key\` = '_cmpb_plan_country'
       LEFT JOIN \`${POSTMETA_TABLE}\` vm ON vm.\`post_id\` = v.\`ID\`
       WHERE v.\`post_type\` = 'product_variation'
       GROUP BY v.\`ID\`, pc.\`meta_value\`, k.\`meta_value\`
       ORDER BY v.\`ID\` ASC`,
      [RECIPE_KEY_META]
    );

    const registrations = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const market = String(row.market || '').trim();
      const key = String(row.recipeKey || '').trim();
      if (!['BR', 'US'].includes(market) || !key || registrations.has(`${market}:${key}`)) {
        continue;
      }
      const name = String(row.label || '').trim().slice(0, 120) || key;
      registrations.set(`${market}:${key}`, { market, key, name });
    }

    for (const { market, key, name } of registrations.values()) {
      // A row created by an earlier image upload keeps its content and gets the name.
      await queryRunner.query(
        `INSERT INTO \`${TABLE}\` (market, flavor_slug, name) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = IF(name = '', VALUES(name), name)`,
        [market, key, name]
      );
    }
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      return;
    }
    // Registrations without content existed only through the backfill.
    await queryRunner.query(`DELETE FROM \`${TABLE}\` WHERE image_url IS NULL AND label IS NULL`);
    if (await queryRunner.hasColumn(TABLE, 'name')) {
      await queryRunner.dropColumn(TABLE, 'name');
    }
  }
}

module.exports = {
  AddRecipeRegistry1700000000040
};
