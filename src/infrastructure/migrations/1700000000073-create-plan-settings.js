const { Table } = require('typeorm');
const { PLAN_SETTINGS_MARKETS, seedLargePackLimit, seedPlanDays } = require('../../core/plan-settings');

const TABLE = 'plan_settings';
const POSTS_TABLE = 'wp_posts';
const POSTMETA_TABLE = 'wp_postmeta';

// One plan settings row per market (plan-settings), seeded with what the recommendation read before: the plan
// days and large-pack limit of the market's first published product (menu order, then id). A row already present
// is kept. The product metas stay in place, so rolling back restores the previous reads.
class CreatePlanSettings1700000000073 {
  name = 'CreatePlanSettings1700000000073';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'market', type: 'varchar', length: '8', isPrimary: true },
          { name: 'plan_days', type: 'int', unsigned: true, isNullable: false },
          { name: 'large_pack_limit', type: 'tinyint', unsigned: true, isNullable: false },
          { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }

    const hasCatalog = (await queryRunner.hasTable(POSTS_TABLE)) && (await queryRunner.hasTable(POSTMETA_TABLE));
    for (const market of PLAN_SETTINGS_MARKETS) {
      const product = hasCatalog ? await this.firstPublishedProduct(queryRunner, market) : null;
      await queryRunner.query(
        `INSERT IGNORE INTO \`${TABLE}\` (market, plan_days, large_pack_limit) VALUES (?, ?, ?)`,
        [market, seedPlanDays(product && product.days), seedLargePackLimit(product && product.large_pack_limit)]
      );
    }
  }

  async firstPublishedProduct(queryRunner, market) {
    const rows = await queryRunner.query(
      `SELECT pm_days.meta_value AS days, pm_limit.meta_value AS large_pack_limit
       FROM \`${POSTS_TABLE}\` p
       INNER JOIN \`${POSTMETA_TABLE}\` pm_country ON pm_country.post_id = p.ID AND pm_country.meta_key = '_cmpb_plan_country'
       LEFT JOIN \`${POSTMETA_TABLE}\` pm_days ON pm_days.post_id = p.ID AND pm_days.meta_key = '_cmpb_plan_days'
       LEFT JOIN \`${POSTMETA_TABLE}\` pm_limit ON pm_limit.post_id = p.ID AND pm_limit.meta_key = '_cmpb_large_pack_limit'
       WHERE p.post_type = 'product' AND p.post_status = 'publish'
         AND UPPER(COALESCE(pm_country.meta_value, '')) = ?
       ORDER BY p.menu_order ASC, p.ID ASC
       LIMIT 1`,
      [market]
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreatePlanSettings1700000000073
};
