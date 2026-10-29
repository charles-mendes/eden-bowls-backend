const path = require('path');
const { TableColumn, TableForeignKey } = require('typeorm');

const RECIPES = 'recipe_contents';
const ASSETS = 'media_assets';
const COLUMN = 'image_asset_id';
const FOREIGN_KEY = 'fk_recipe_contents_image_asset_id';

// Links each recipe's banner to a library image (plan-image-library, kind banner). image_url stays, written with
// the id, so the store and the activation checks keep reading the URL. Banners stored before become assets with
// the same URL, one row at a time like 1700000000058.
class LinkRecipeBannerImageAsset1700000000059 {
  name = 'LinkRecipeBannerImageAsset1700000000059';

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
      `SELECT id, market, image_url FROM \`${RECIPES}\`
        WHERE image_url IS NOT NULL AND image_url <> '' AND ${COLUMN} IS NULL`
    );
    for (const row of rows) {
      const url = String(row.image_url);
      const result = await queryRunner.query(
        `INSERT INTO \`${ASSETS}\` (kind, market, url, original_filename, mime_type) VALUES ('banner', ?, ?, ?, 'image/webp')`,
        [String(row.market).toUpperCase(), url, basename(url)]
      );
      await queryRunner.query(`UPDATE \`${RECIPES}\` SET ${COLUMN} = ? WHERE id = ?`, [result.insertId, row.id]);
    }
  }

  // The backfilled assets stay: image_url still points at the same files.
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
  LinkRecipeBannerImageAsset1700000000059
};
