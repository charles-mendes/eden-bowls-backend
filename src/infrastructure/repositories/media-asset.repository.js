const { HttpError } = require('../../core/http-error');
const { toIsoDateTime } = require('./onboarding-pets.repository');

const COLUMNS = 'id, kind, market, url, original_filename, mime_type, width, height, bytes, uploaded_by, created_at, archived_at';

// Admin image library (plan-image-library). There is no delete: archived_at only hides an image from the list.
class MediaAssetRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'media_assets';
    this.recipeTableName = options.recipeTableName || 'recipe_contents';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row, usedBy = []) {
    if (!row) {
      return null;
    }
    const number = (value) => (value == null ? null : Number(value));
    return {
      id: Number(row.id),
      kind: String(row.kind),
      market: String(row.market || '').toUpperCase(),
      url: String(row.url),
      originalFilename: String(row.original_filename || ''),
      mimeType: String(row.mime_type || ''),
      width: number(row.width),
      height: number(row.height),
      bytes: number(row.bytes),
      uploadedBy: number(row.uploaded_by),
      createdAt: toIsoDateTime(row.created_at),
      archivedAt: toIsoDateTime(row.archived_at),
      archived: row.archived_at != null,
      usedBy
    };
  }

  // Recipes linking to each image, by image id: [{ key, name, market }].
  async usedByIds(ids, runner = this.dataSource) {
    const byId = new Map(ids.map((id) => [Number(id), []]));
    if (ids.length === 0) {
      return byId;
    }
    const rows = await runner.query(
      `SELECT plan_image_asset_id, market, flavor_slug, name FROM \`${this.recipeTableName}\`
        WHERE plan_image_asset_id IN (${ids.map(() => '?').join(', ')}) ORDER BY flavor_slug`,
      ids.map(Number)
    );
    for (const row of rows) {
      byId.get(Number(row.plan_image_asset_id)).push({
        key: String(row.flavor_slug),
        name: String(row.name || '').trim() || String(row.flavor_slug),
        market: String(row.market || '').toUpperCase()
      });
    }
    return byId;
  }

  async withUsage(rows, runner) {
    const usedBy = await this.usedByIds(rows.map((row) => row.id), runner);
    return rows.map((row) => this.mapRow(row, usedBy.get(Number(row.id))));
  }

  async findById(id, runner = this.dataSource) {
    this.ensureDataSource();
    const rows = await runner.query(`SELECT ${COLUMNS} FROM \`${this.tableName}\` WHERE id = ? LIMIT 1`, [Number(id)]);
    const [asset] = await this.withUsage(rows, runner);
    return asset || null;
  }

  async findByHash({ market, kind, sha256 }) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT ${COLUMNS} FROM \`${this.tableName}\` WHERE market = ? AND kind = ? AND sha256 = ? LIMIT 1`,
      [String(market).toUpperCase(), String(kind), String(sha256)]
    );
    const [asset] = await this.withUsage(rows);
    return asset || null;
  }

  // Newest first; archived images only when asked for, and then only them.
  async list({ market, kind, archived = false }) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT ${COLUMNS} FROM \`${this.tableName}\`
        WHERE market = ? AND kind = ? AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
        ORDER BY created_at DESC, id DESC`,
      [String(market).toUpperCase(), String(kind)]
    );
    return this.withUsage(rows);
  }

  // null when the same bytes were stored by a concurrent upload: the caller reads that one by hash.
  async insert({ kind, market, url, originalFilename, mimeType, width, height, bytes, sha256, uploadedBy = null }) {
    this.ensureDataSource();
    try {
      const result = await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\`
          (kind, market, url, original_filename, mime_type, width, height, bytes, sha256, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [String(kind), String(market).toUpperCase(), String(url), String(originalFilename), String(mimeType),
          width, height, bytes, sha256, uploadedBy]
      );
      return this.findById(result.insertId);
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) {
        return null;
      }
      throw error;
    }
  }

  // Locks the image so a concurrent link waits (RecipeContentRepository.setPlanImage locks it too). An image in
  // use is left as is and returned with its usedBy; an archived one stays archived since its first archive.
  async archive(id) {
    this.ensureDataSource();
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(`SELECT id FROM \`${this.tableName}\` WHERE id = ? FOR UPDATE`, [Number(id)]);
      if (rows.length === 0) {
        return null;
      }
      const usedBy = (await this.usedByIds([id], manager)).get(Number(id));
      if (usedBy.length === 0) {
        await manager.query(
          `UPDATE \`${this.tableName}\` SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`,
          [Number(id)]
        );
      }
      return this.findById(id, manager);
    });
  }

  async restore(id) {
    this.ensureDataSource();
    await this.dataSource.query(`UPDATE \`${this.tableName}\` SET archived_at = NULL WHERE id = ?`, [Number(id)]);
    return this.findById(id);
  }
}

module.exports = {
  MediaAssetRepository
};
