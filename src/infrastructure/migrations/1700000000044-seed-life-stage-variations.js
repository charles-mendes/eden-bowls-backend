const { RECIPE_KEY_META } = require('../../core/recipe-content');
const { FLAVOR_SLUG_META } = require('../../core/flavors');
const {
  LIFE_STAGE_RECIPES,
  SEEDED_BY_META,
  SEED_MARKETS,
  planLifeStageVariations,
  variationMeta
} = require('./helpers/seed-life-stage-variations');

const NAME = 'SeedLifeStageVariations1700000000044';

// Creates, in every environment, the puppy and senior variations that the plan product of each market is
// still missing (add-life-stage-recipes task 1.8), so QA and production get them on deploy without manual
// admin work. They are created inactive (draft); activating one in the admin syncs its Stripe price and checks
// its photo and label, as for any variation. A recipe already created by hand without a pack weight is left
// as it is and named in the log.
class SeedLifeStageVariations1700000000044 {
  name = NAME;

  async up(queryRunner, logger = console) {
    if (!(await queryRunner.hasTable('wp_posts')) || !(await queryRunner.hasTable('wp_postmeta'))) {
      return;
    }
    const keys = LIFE_STAGE_RECIPES.map((recipe) => recipe.key);

    for (const market of SEED_MARKETS) {
      const products = await queryRunner.query(
        [
          'SELECT p.`ID` AS id FROM `wp_posts` p',
          "JOIN `wp_postmeta` m ON m.`post_id` = p.`ID` AND m.`meta_key` = '_cmpb_plan_country' AND m.`meta_value` = ?",
          "WHERE p.`post_type` = 'product' AND p.`post_status` <> 'trash' ORDER BY p.`ID` LIMIT 1"
        ].join(' '),
        [market]
      );
      const productId = Array.isArray(products) && products[0] ? Number(products[0].id) : 0;
      if (!productId) {
        logger.warn(`[${NAME}] ${market}: no plan product; nothing seeded.`);
        continue;
      }

      const rows = await queryRunner.query(
        [
          'SELECT v.`ID` AS id,',
          `COALESCE(NULLIF(MAX(CASE WHEN vm.\`meta_key\` = '${RECIPE_KEY_META}' THEN vm.\`meta_value\` END), ''),`,
          `MAX(CASE WHEN vm.\`meta_key\` = '${FLAVOR_SLUG_META}' THEN vm.\`meta_value\` END)) AS recipeKey,`,
          "MAX(CASE WHEN vm.`meta_key` = 'attribute_pa_weight' THEN vm.`meta_value` END) AS weight",
          'FROM `wp_posts` v LEFT JOIN `wp_postmeta` vm ON vm.`post_id` = v.`ID`',
          "WHERE v.`post_type` = 'product_variation' AND v.`post_parent` = ? AND v.`post_status` <> 'trash'",
          'GROUP BY v.`ID`'
        ].join(' '),
        [productId]
      );
      const existing = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ recipeKey: String(row.recipeKey || '').trim(), weight: row.weight }))
        .filter((row) => keys.includes(row.recipeKey));

      const { create, skipped } = planLifeStageVariations(market, existing);
      for (const item of skipped) {
        logger.warn(`[${NAME}] ${market} ${item.key}: skipped (${item.reason}); check it in the admin.`);
      }

      for (const variation of create) {
        const [{ nextId }] = await queryRunner.query('SELECT COALESCE(MAX(`ID`), 0) + 1 AS nextId FROM `wp_posts`');
        const [{ nextOrder }] = await queryRunner.query(
          "SELECT COALESCE(MAX(`menu_order`), 0) + 1 AS nextOrder FROM `wp_posts` WHERE `post_type` = 'product_variation' AND `post_parent` = ?",
          [productId]
        );
        const id = Number(nextId);
        await queryRunner.query(
          [
            'INSERT INTO `wp_posts` (`ID`, `post_parent`, `post_type`, `post_status`, `post_title`, `post_name`, `menu_order`)',
            "VALUES (?, ?, 'product_variation', 'draft', ?, ?, ?)"
          ].join(' '),
          [id, productId, variation.title, variation.sku.toLowerCase(), Number(nextOrder)]
        );
        const meta = variationMeta(variation, NAME);
        await queryRunner.query(
          'INSERT INTO `wp_postmeta` (`post_id`, `meta_key`, `meta_value`) VALUES ' + meta.map(() => '(?, ?, ?)').join(', '),
          meta.flatMap(([key, value]) => [id, key, value])
        );
      }
      logger.log(`[${NAME}] ${market}: created ${create.length} inactive variation(s), skipped ${skipped.length} recipe(s).`);
    }
  }

  // Removes only the variations this seed created and nobody activated; an activated one may already be sold.
  async down(queryRunner) {
    if (!(await queryRunner.hasTable('wp_posts')) || !(await queryRunner.hasTable('wp_postmeta'))) {
      return;
    }
    const rows = await queryRunner.query(
      [
        'SELECT v.`ID` AS id FROM `wp_posts` v',
        'JOIN `wp_postmeta` m ON m.`post_id` = v.`ID` AND m.`meta_key` = ? AND m.`meta_value` = ?',
        "WHERE v.`post_type` = 'product_variation' AND v.`post_status` = 'draft'"
      ].join(' '),
      [SEEDED_BY_META, NAME]
    );
    const ids = (Array.isArray(rows) ? rows : []).map((row) => Number(row.id)).filter(Boolean);
    if (ids.length === 0) {
      return;
    }
    const placeholders = ids.map(() => '?').join(', ');
    await queryRunner.query(`DELETE FROM \`wp_postmeta\` WHERE \`post_id\` IN (${placeholders})`, ids);
    await queryRunner.query(`DELETE FROM \`wp_posts\` WHERE \`ID\` IN (${placeholders})`, ids);
  }
}

module.exports = {
  SeedLifeStageVariations1700000000044
};
