const path = require('path');
const { TableColumn, TableForeignKey } = require('typeorm');

const RECIPES = 'recipe_contents';
const ASSETS = 'media_assets';
const COLUMN = 'plan_image_asset_id';
const FOREIGN_KEY = 'fk_recipe_contents_plan_image_asset_id';

// Links each recipe's plan thumbnail to a library image (plan-image-library). plan_image_url stays, written with
// the id, so the store keeps reading the URL. Thumbnails stored before the library become assets with the same
// URL, one row at a time so no string join depends on the two tables sharing a collation.
class LinkRecipePlanImageAsset1700000000058 {
  name = 'LinkRecipePlanImageAsset1700000000058';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(RECIPES)) || !(await queryRunner.hasTable(ASSETS))) {
      return;
    }
    if (!(await queryRunner.hasColumn(RECIPES, COLUMN))) {
      await queryRunner.addColumn(RECIPES, new TableColumn({ name: COLUMN, type: 'int', unsigned: true, isNullable: true }));
      await queryRunner.createForeignKey(RECIPES, new TableForeignKey({
        name: FOREIGN_KEY,
        columnNames: [COLUMN],
        referencedTableName: ASSETS,
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT'
      }));
    }

    const rows = await queryRunner.query(
      `SELECT id, market, plan_image_url FROM \`${RECIPES}\`
        WHERE plan_image_url IS NOT NULL AND plan_image_url <> '' AND ${COLUMN} IS NULL`
    );
    for (const row of rows) {
      const url = String(row.plan_image_url);
      const result = await queryRunner.query(
        `INSERT INTO \`${ASSETS}\` (kind, market, url, original_filename, mime_type) VALUES ('plan', ?, ?, ?, 'image/webp')`,
        [String(row.market).toUpperCase(), url, basename(url)]
      );
      await queryRunner.query(`UPDATE \`${RECIPES}\` SET ${COLUMN} = ? WHERE id = ?`, [result.insertId, row.id]);
    }
  }

  // The backfilled assets stay: plan_image_url still points at the same files.
  async down(queryRunner) {
    if (!(await queryRunner.hasTable(RECIPES)) || !(await queryRunner.hasColumn(RECIPES, COLUMN))) {
      return;
    }
    const table = await queryRunner.getTable(RECIPES);
    const foreignKey = table && table.foreignKeys.find((key) => key.name === FOREIGN_KEY);
    if (foreignKey) {
      await queryRunner.dropForeignKey(RECIPES, foreignKey);
    }
    await queryRunner.dropColumn(RECIPES, COLUMN);
  }
}

function basename(url) {
  try {
    return path.basename(new URL(url, 'http://localhost').pathname) || url;
  } catch {
    return path.basename(url) || url;
  }
}

module.exports = {
  LinkRecipePlanImageAsset1700000000058
};
