const { HttpError } = require('../../core/http-error');
const { parseJsonColumn } = require('../../core/stripe-subscription-map');
const { toIsoDateTime } = require('./onboarding-pets.repository');
const { LIFE_STAGES } = require('../../core/flavors');

// Recipe registration with its image and label, one row per market and recipe key (recipe-content).
class RecipeContentRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'recipe_contents';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  mapRow(row) {
    if (!row) {
      return null;
    }

    return {
      market: String(row.market || '').toUpperCase(),
      flavorSlug: String(row.flavor_slug || ''),
      name: String(row.name || '').trim() || String(row.flavor_slug || ''),
      lifeStage: LIFE_STAGES.includes(row.life_stage) ? row.life_stage : 'adult',
      imageUrl: row.image_url ? String(row.image_url) : null,
      imageUpdatedAt: toIsoDateTime(row.image_updated_at),
      planImageUrl: row.plan_image_url ? String(row.plan_image_url) : null,
      planImageUpdatedAt: toIsoDateTime(row.plan_image_updated_at),
      label: parseJsonColumn(row.label),
      labelUpdatedAt: toIsoDateTime(row.label_updated_at)
    };
  }

  async findByMarketAndSlug(market, flavorSlug) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, flavor_slug, name, life_stage, image_url, image_updated_at, plan_image_url, plan_image_updated_at, label, label_updated_at
       FROM \`${this.tableName}\` WHERE market = ? AND flavor_slug = ? LIMIT 1`,
      [String(market).toUpperCase(), String(flavorSlug)]
    );
    return this.mapRow(Array.isArray(rows) ? rows[0] : null);
  }

  // Content of several flavors of one market, keyed by flavor slug (one query per product detail).
  async findByMarketAndSlugs(market, flavorSlugs) {
    const slugs = [...new Set((flavorSlugs || []).map((slug) => String(slug || '').trim()).filter(Boolean))];
    if (slugs.length === 0) {
      return new Map();
    }
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, flavor_slug, name, life_stage, image_url, image_updated_at, plan_image_url, plan_image_updated_at, label, label_updated_at
       FROM \`${this.tableName}\` WHERE market = ? AND flavor_slug IN (${slugs.map(() => '?').join(', ')})`,
      [String(market).toUpperCase(), ...slugs]
    );
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.flavor_slug), this.mapRow(row)]));
  }

  async listByMarket(market) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, flavor_slug, name, life_stage, image_url, image_updated_at, plan_image_url, plan_image_updated_at, label, label_updated_at
       FROM \`${this.tableName}\` WHERE market = ? ORDER BY flavor_slug ASC`,
      [String(market).toUpperCase()]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => this.mapRow(row));
  }

  async createRecipe({ market, flavorSlug, name, lifeStage = 'adult', actorId = null }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (market, flavor_slug, name, life_stage, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [String(market).toUpperCase(), String(flavorSlug), String(name), String(lifeStage), actorId]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }

  // Name and/or life stage of a registered recipe; a field left undefined keeps its value.
  async updateRecipe({ market, flavorSlug, name, lifeStage, actorId = null }) {
    this.ensureDataSource();
    const sets = [];
    const params = [];
    if (name !== undefined) {
      sets.push('name = ?');
      params.push(String(name));
    }
    if (lifeStage !== undefined) {
      sets.push('life_stage = ?');
      params.push(String(lifeStage));
    }
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${[...sets, 'updated_by = ?'].join(', ')} WHERE market = ? AND flavor_slug = ?`,
      [...params, actorId, String(market).toUpperCase(), String(flavorSlug)]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }

  async deleteRecipe({ market, flavorSlug }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE market = ? AND flavor_slug = ?`,
      [String(market).toUpperCase(), String(flavorSlug)]
    );
  }

  async upsertImage({ market, flavorSlug, imageUrl, actorId = null }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (market, flavor_slug, image_url, image_updated_at, updated_by)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), image_updated_at = VALUES(image_updated_at),
         updated_by = VALUES(updated_by)`,
      [String(market).toUpperCase(), String(flavorSlug), String(imageUrl), actorId]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }

  async upsertLabel({ market, flavorSlug, label, actorId = null }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (market, flavor_slug, label, label_updated_at, updated_by)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), label_updated_at = VALUES(label_updated_at),
         updated_by = VALUES(updated_by)`,
      [String(market).toUpperCase(), String(flavorSlug), JSON.stringify(label), actorId]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }

  async setPlanImage({ market, flavorSlug, imageUrl, actorId = null }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET plan_image_url = ?, plan_image_updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE market = ? AND flavor_slug = ?`,
      [imageUrl == null ? null : String(imageUrl), actorId, String(market).toUpperCase(), String(flavorSlug)]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }

  async clearImage({ market, flavorSlug, actorId = null }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET image_url = NULL, image_updated_at = CURRENT_TIMESTAMP, updated_by = ?
       WHERE market = ? AND flavor_slug = ?`,
      [actorId, String(market).toUpperCase(), String(flavorSlug)]
    );
    return this.findByMarketAndSlug(market, flavorSlug);
  }
}

module.exports = {
  RecipeContentRepository
};
