const { LIFE_STAGE_META } = require('../../core/flavors');

const POSTS_TABLE = 'wp_posts';
const POSTMETA_TABLE = 'wp_postmeta';
const FLAVOR_CATEGORY_SLUG = 'flavors';

// Every recipe sold today is an adult recipe, so the backfill only tags what already exists.
class AddVariationLifeStage1700000000034 {
  name = 'AddVariationLifeStage1700000000034';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(POSTS_TABLE)) || !(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }
    await queryRunner.query(
      `INSERT INTO \`${POSTMETA_TABLE}\` (\`post_id\`, \`meta_key\`, \`meta_value\`)
       SELECT v.\`ID\`, ?, 'adult'
       FROM \`${POSTS_TABLE}\` v
       INNER JOIN \`wp_term_relationships\` tr ON tr.\`object_id\` = v.\`post_parent\`
       INNER JOIN \`wp_term_taxonomy\` tt ON tt.\`term_taxonomy_id\` = tr.\`term_taxonomy_id\` AND tt.\`taxonomy\` = 'product_cat'
       INNER JOIN \`wp_terms\` t ON t.\`term_id\` = tt.\`term_id\` AND t.\`slug\` = ?
       WHERE v.\`post_type\` = 'product_variation'
       AND NOT EXISTS (
         SELECT 1 FROM \`${POSTMETA_TABLE}\` m WHERE m.\`post_id\` = v.\`ID\` AND m.\`meta_key\` = ?
       )`,
      [LIFE_STAGE_META, FLAVOR_CATEGORY_SLUG, LIFE_STAGE_META]
    );
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable(POSTMETA_TABLE))) {
      return;
    }
    await queryRunner.query(`DELETE FROM \`${POSTMETA_TABLE}\` WHERE \`meta_key\` = ?`, [LIFE_STAGE_META]);
  }
}

module.exports = {
  AddVariationLifeStage1700000000034
};
